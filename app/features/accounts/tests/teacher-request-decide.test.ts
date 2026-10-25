import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { LOAN_RULES } from "@/features/loans/schema";
import { createDailyFineStrategy } from "@/features/loans/server/fine-strategy";
import { createLoanService } from "@/features/loans/server/loan-service";
import { ConflictError, ForbiddenError, NotFoundError } from "@/shared/server/errors";
import { createSessionResolver } from "@/shared/server/security/session";
import { aBook } from "@/tests/helpers/factories";
import {
  countOk,
  DAY_MS,
  makeTeacherWorld,
  NOTE,
  outcomeOf,
  type Person,
  T0,
  type TeacherWorld,
} from "@/tests/helpers/teacher-requests";
import { TeacherRequestSchema } from "../schema";

let world: TeacherWorld;
let staff: Person;
const DECIDED = new Date("2026-01-12T15:30:00.000Z");

beforeEach(async () => {
  world = makeTeacherWorld();
  staff = await world.addPerson("BIBLIOTECARIO");
});

/** Una persona con una solicitud pendiente. */
async function pendingPerson(role: "EXTERNO" | "ESTUDIANTE" = "ESTUDIANTE", verified = true): Promise<Person> {
  const person = await world.addPerson(role, { verified });
  await world.ask(person);
  return person;
}

describe("F12 · aprobar · caso feliz (regla 13)", () => {
  it.each(["EXTERNO", "ESTUDIANTE"] as const)("aprobar la solicitud de un %s lo pasa a DOCENTE", async (role) => {
    const person = await pendingPerson(role);

    const approved = await world.service.approve(staff.actor, person.id, DECIDED);

    expect(await world.roleOf(person)).toBe("DOCENTE");
    expect(approved.status).toBe("APROBADA");
  });

  it("la solicitud queda APROBADA con la fecha de la decisión y quién decidió", async () => {
    const person = await pendingPerson();

    const approved = await world.service.approve(staff.actor, person.id, DECIDED);

    expect(TeacherRequestSchema.strict().parse(approved)).toEqual({
      member_id: person.id,
      note: NOTE,
      status: "APROBADA",
      requested_at: T0.toISOString(),
      decided_at: DECIDED.toISOString(),
      decided_by: staff.id,
      reason: null,
    });
    expect(await world.requests.get(person.id)).toEqual(approved);
  });

  it("un ADMINISTRADOR también puede aprobar y queda como quien decidió", async () => {
    const admin = await world.addPerson("ADMINISTRADOR");
    const person = await pendingPerson();

    const approved = await world.service.approve(admin.actor, person.id, DECIDED);

    expect(approved.decided_by).toBe(admin.id);
  });

  it("aprobar no toca las demás solicitudes ni las demás cuentas", async () => {
    const approvedPerson = await pendingPerson();
    const other = await pendingPerson("EXTERNO");

    await world.service.approve(staff.actor, approvedPerson.id, DECIDED);

    expect(await world.roleOf(other)).toBe("EXTERNO");
    expect((await world.requests.get(other.id))?.status).toBe("PENDIENTE");
  });

  it("después de aprobar, la persona ya no puede volver a pedir (409 «Ya eres docente.» con su rol nuevo)", async () => {
    const person = await pendingPerson();
    await world.service.approve(staff.actor, person.id, DECIDED);
    const nowTeacher = { ...person.actor, role: "DOCENTE" } as const;

    await expect(world.service.request(nowTeacher, { note: NOTE }, DECIDED)).rejects.toThrow("Ya eres docente.");
  });
});

describe("F12 · el cambio de rol se ve en la siguiente resolución de sesión (criterio de aceptación)", () => {
  function resolverFor() {
    return createSessionResolver({
      verifySessionCookie: (cookie) => world.identity.verifySessionCookie(cookie),
      loadMember: (uid) => world.accounts.findById(uid),
    });
  }

  it("la misma cookie, sin volver a ingresar, resuelve a DOCENTE después de aprobar", async () => {
    const person = await pendingPerson();
    const email = (await world.repos.members.findById(person.id))?.email ?? "";
    const idToken = await world.identity.signIn(email, "clave-segura-123");
    const cookie = await world.identity.createSessionCookie(idToken ?? "", 3600);
    expect(await resolverFor()(cookie)).toEqual({ member_id: person.id, role: "ESTUDIANTE" });

    await world.service.approve(staff.actor, person.id, DECIDED);

    expect(await resolverFor()(cookie)).toEqual({ member_id: person.id, role: "DOCENTE" });
  });
});

describe("F12 · aprobar no recalcula nada: plazo y cupo rigen desde el siguiente préstamo (regla 14)", () => {
  function loansFor() {
    return createLoanService({
      books: world.repos.books,
      members: world.repos.members,
      loans: world.repos.loans,
      fine: createDailyFineStrategy(),
    });
  }

  it("el préstamo abierto conserva su vencimiento y el siguiente usa los 30 días del docente", async () => {
    const person = await pendingPerson();
    const loans = loansFor();
    const first = await world.repos.books.create(aBook({ copies: 2 }));
    const second = await world.repos.books.create(aBook({ copies: 2 }));
    const before = await loans.lend({ member_id: person.id, book_id: first.id }, staff.actor, T0);

    await world.service.approve(staff.actor, person.id, DECIDED);
    const after = await loans.lend({ member_id: person.id, book_id: second.id }, staff.actor, DECIDED);

    expect(Date.parse(before.due_at) - T0.getTime()).toBe(LOAN_RULES.loanDaysByRole.ESTUDIANTE * DAY_MS);
    expect(before.due_at).toBe(new Date(T0.getTime() + 20 * DAY_MS).toISOString());
    const stillOpen = (await loans.listActiveByMember(person.id, staff.actor, DECIDED)).find(
      (active) => active.loan.id === before.id,
    );
    expect(stillOpen?.loan.due_at).toBe(before.due_at);
    expect(Date.parse(after.due_at) - DECIDED.getTime()).toBe(30 * DAY_MS);
  });

  it("el cupo pasa de 3 a 5 desde el siguiente préstamo", async () => {
    const person = await pendingPerson();
    const loans = loansFor();
    for (let i = 0; i < 3; i += 1) {
      const book = await world.repos.books.create(aBook({ copies: 2 }));
      await loans.lend({ member_id: person.id, book_id: book.id }, staff.actor, T0);
    }
    const extra = await world.repos.books.create(aBook({ copies: 2 }));
    await expect(loans.lend({ member_id: person.id, book_id: extra.id }, staff.actor, T0)).rejects.toThrow(
      ConflictError,
    );

    await world.service.approve(staff.actor, person.id, DECIDED);

    const fourth = await loans.lend({ member_id: person.id, book_id: extra.id }, staff.actor, DECIDED);
    expect(fourth.member_id).toBe(person.id);
  });
});

describe("F12 · aprobar · quién puede y errores (reglas 13 y 15)", () => {
  it.each(["EXTERNO", "ESTUDIANTE", "DOCENTE"] as const)("un %s no puede aprobar: 403", async (role) => {
    const person = await pendingPerson();
    const actor = await world.addPerson(role);

    await expect(world.service.approve(actor.actor, person.id, DECIDED)).rejects.toThrow(ForbiddenError);

    expect((await world.requests.get(person.id))?.status).toBe("PENDIENTE");
    expect(await world.roleOf(person)).toBe("ESTUDIANTE");
  });

  it("el dueño de la solicitud no puede aprobar la suya", async () => {
    const person = await pendingPerson();

    await expect(world.service.approve(person.actor, person.id, DECIDED)).rejects.toThrow(ForbiddenError);

    expect(await world.roleOf(person)).toBe("ESTUDIANTE");
  });

  it("una solicitud inexistente da 404", async () => {
    await expect(world.service.approve(staff.actor, "no-existe", DECIDED)).rejects.toThrow(NotFoundError);
  });

  it("una persona que nunca pidió el rol da 404 (hay cuenta pero no solicitud)", async () => {
    const person = await world.addPerson("ESTUDIANTE");

    await expect(world.service.approve(staff.actor, person.id, DECIDED)).rejects.toThrow(NotFoundError);
    expect(await world.roleOf(person)).toBe("ESTUDIANTE");
  });

  it("aprobar dos veces: la segunda da 409 «La solicitud ya fue resuelta.» y nada cambia", async () => {
    const person = await pendingPerson();
    const first = await world.service.approve(staff.actor, person.id, DECIDED);

    const again = world.service.approve(staff.actor, person.id, new Date(DECIDED.getTime() + DAY_MS));

    await expect(again).rejects.toThrow(ConflictError);
    await expect(again).rejects.toThrow("La solicitud ya fue resuelta.");
    expect(await world.requests.get(person.id)).toEqual(first);
  });

  it("aprobar una solicitud ya rechazada: 409 y sigue rechazada, el rol no cambia", async () => {
    const person = await pendingPerson();
    const rejected = await world.service.reject(staff.actor, person.id, { reason: "Sin pruebas" }, DECIDED);

    await expect(world.service.approve(staff.actor, person.id, DECIDED)).rejects.toThrow(
      "La solicitud ya fue resuelta.",
    );

    expect(await world.requests.get(person.id)).toEqual(rejected);
    expect(await world.roleOf(person)).toBe("ESTUDIANTE");
  });

  it("una solicitud ya resuelta da «ya fue resuelta» aunque la cuenta se haya desactivado después", async () => {
    const person = await pendingPerson();
    await world.service.reject(staff.actor, person.id, {}, DECIDED);
    world.deactivate(person);

    await expect(world.service.approve(staff.actor, person.id, DECIDED)).rejects.toThrow(
      "La solicitud ya fue resuelta.",
    );
  });
});

describe("F12 · aprobar · la cuenta cambió desde que pidió (regla 13, bordes)", () => {
  const ACCOUNT_MESSAGE = "La cuenta ya no puede recibir el rol de docente.";

  it("cuenta desactivada: 409 y la solicitud sigue PENDIENTE", async () => {
    const person = await pendingPerson();
    world.deactivate(person);

    const attempt = world.service.approve(staff.actor, person.id, DECIDED);

    await expect(attempt).rejects.toThrow(ConflictError);
    await expect(attempt).rejects.toThrow(ACCOUNT_MESSAGE);
    expect((await world.requests.get(person.id))?.status).toBe("PENDIENTE");
    expect(await world.roleOf(person)).toBe("ESTUDIANTE");
  });

  it("la cuenta ya es DOCENTE (por otra vía): 409 y la solicitud sigue PENDIENTE", async () => {
    const person = await pendingPerson();
    await world.repos.members.setRole(person.id, "DOCENTE");

    await expect(world.service.approve(staff.actor, person.id, DECIDED)).rejects.toThrow(ACCOUNT_MESSAGE);

    const stored = await world.requests.get(person.id);
    expect(stored?.status).toBe("PENDIENTE");
    expect(stored?.decided_by).toBeNull();
  });

  it("la cuenta pasó a ser de personal: 409 y no se le cambia el rol a DOCENTE", async () => {
    const person = await pendingPerson();
    await world.repos.members.setRole(person.id, "BIBLIOTECARIO");

    await expect(world.service.approve(staff.actor, person.id, DECIDED)).rejects.toThrow(ACCOUNT_MESSAGE);

    expect(await world.roleOf(person)).toBe("BIBLIOTECARIO");
    expect((await world.requests.get(person.id))?.status).toBe("PENDIENTE");
  });

  it("la cuenta fue borrada: 409 y la solicitud sigue PENDIENTE", async () => {
    const ghost = await world.requests.create(
      {
        member_id: "cuenta-borrada",
        note: NOTE,
        status: "PENDIENTE",
        requested_at: T0.toISOString(),
        decided_at: null,
        decided_by: null,
        reason: null,
      },
      new Date(T0.getTime() - 7 * DAY_MS),
    );

    await expect(world.service.approve(staff.actor, ghost.member_id, DECIDED)).rejects.toThrow(ConflictError);

    expect((await world.requests.get(ghost.member_id))?.status).toBe("PENDIENTE");
  });

  it("el correo dejó de estar verificado: 409 y la solicitud sigue PENDIENTE", async () => {
    const person = await pendingPerson();
    world.identity.markEmailUnverified(person.id);

    const attempt = world.service.approve(staff.actor, person.id, DECIDED);

    await expect(attempt).rejects.toThrow(ConflictError);
    await expect(attempt).rejects.toThrow("El correo de la persona ya no está verificado.");
    expect((await world.requests.get(person.id))?.status).toBe("PENDIENTE");
    expect(await world.roleOf(person)).toBe("ESTUDIANTE");
  });

  it("si el correo se vuelve a verificar, la misma solicitud se puede aprobar", async () => {
    const person = await pendingPerson();
    world.identity.markEmailUnverified(person.id);
    await expect(world.service.approve(staff.actor, person.id, DECIDED)).rejects.toThrow(ConflictError);

    world.identity.markEmailVerified(person.id);

    expect((await world.service.approve(staff.actor, person.id, DECIDED)).status).toBe("APROBADA");
  });
});

describe("F12 · rechazar · caso feliz y motivo (regla 13)", () => {
  it("rechaza con motivo: RECHAZADA, con fecha, quién decidió y el motivo; el rol no cambia", async () => {
    const person = await pendingPerson();

    const rejected = await world.service.reject(
      staff.actor,
      person.id,
      { reason: "No pudimos comprobar tu cargo" },
      DECIDED,
    );

    expect(TeacherRequestSchema.strict().parse(rejected)).toEqual({
      member_id: person.id,
      note: NOTE,
      status: "RECHAZADA",
      requested_at: T0.toISOString(),
      decided_at: DECIDED.toISOString(),
      decided_by: staff.id,
      reason: "No pudimos comprobar tu cargo",
    });
    expect(await world.roleOf(person)).toBe("ESTUDIANTE");
    expect(await world.requests.get(person.id)).toEqual(rejected);
  });

  it("un ADMINISTRADOR también puede rechazar", async () => {
    const admin = await world.addPerson("ADMINISTRADOR");
    const person = await pendingPerson();

    expect((await world.service.reject(admin.actor, person.id, {}, DECIDED)).decided_by).toBe(admin.id);
  });

  it.each([
    ["ausente", {}],
    ["una cadena vacía", { reason: "" }],
    ["solo espacios", { reason: "    " }],
  ])("motivo %s: se guarda null", async (_name, input) => {
    const person = await pendingPerson();

    const rejected = await world.service.reject(staff.actor, person.id, input, DECIDED);

    expect(rejected.status).toBe("RECHAZADA");
    expect(rejected.reason).toBeNull();
  });

  it("el motivo se guarda recortado", async () => {
    const person = await pendingPerson();

    expect((await world.service.reject(staff.actor, person.id, { reason: "  Sin pruebas  " }, DECIDED)).reason).toBe(
      "Sin pruebas",
    );
  });

  it.each([
    [1, true],
    [299, true],
    [300, true],
    [301, false],
  ])("motivo de %i caracteres: aceptado=%s", async (length, accepted) => {
    const person = await pendingPerson();
    const attempt = await outcomeOf(
      world.service.reject(staff.actor, person.id, { reason: "m".repeat(length) }, DECIDED),
    );

    expect(attempt.ok).toBe(accepted);
    expect((await world.requests.get(person.id))?.status === "RECHAZADA").toBe(accepted);
  });

  it("un motivo de 301 caracteres es un error de validación y la solicitud sigue PENDIENTE", async () => {
    const person = await pendingPerson();

    await expect(world.service.reject(staff.actor, person.id, { reason: "m".repeat(301) }, DECIDED)).rejects.toThrow(
      ZodError,
    );

    expect((await world.requests.get(person.id))?.status).toBe("PENDIENTE");
  });

  it("300 caracteres más espacios alrededor se aceptan (se recorta antes de contar)", async () => {
    const person = await pendingPerson();

    const rejected = await world.service.reject(staff.actor, person.id, { reason: ` ${"m".repeat(300)} ` }, DECIDED);

    expect(rejected.reason).toHaveLength(300);
  });

  it("rechazar no exige que la cuenta siga activa ni que el correo esté verificado", async () => {
    const person = await pendingPerson();
    world.deactivate(person);
    world.identity.markEmailUnverified(person.id);

    expect((await world.service.reject(staff.actor, person.id, {}, DECIDED)).status).toBe("RECHAZADA");
  });
});

describe("F12 · rechazar · quién puede y errores", () => {
  it.each(["EXTERNO", "ESTUDIANTE", "DOCENTE"] as const)("un %s no puede rechazar: 403", async (role) => {
    const person = await pendingPerson();
    const actor = await world.addPerson(role);

    await expect(world.service.reject(actor.actor, person.id, {}, DECIDED)).rejects.toThrow(ForbiddenError);

    expect((await world.requests.get(person.id))?.status).toBe("PENDIENTE");
  });

  it("una solicitud inexistente da 404", async () => {
    await expect(world.service.reject(staff.actor, "no-existe", {}, DECIDED)).rejects.toThrow(NotFoundError);
  });

  it("rechazar una ya rechazada: 409 «La solicitud ya fue resuelta.» y se conserva la primera decisión", async () => {
    const person = await pendingPerson();
    const first = await world.service.reject(staff.actor, person.id, { reason: "Primera" }, DECIDED);

    const again = world.service.reject(
      staff.actor,
      person.id,
      { reason: "Segunda" },
      new Date(DECIDED.getTime() + DAY_MS),
    );

    await expect(again).rejects.toThrow(ConflictError);
    await expect(again).rejects.toThrow("La solicitud ya fue resuelta.");
    expect(await world.requests.get(person.id)).toEqual(first);
  });

  it("rechazar una ya aprobada: 409 y el rol DOCENTE se conserva", async () => {
    const person = await pendingPerson();
    const approved = await world.service.approve(staff.actor, person.id, DECIDED);

    await expect(world.service.reject(staff.actor, person.id, {}, DECIDED)).rejects.toThrow(
      "La solicitud ya fue resuelta.",
    );

    expect(await world.requests.get(person.id)).toEqual(approved);
    expect(await world.roleOf(person)).toBe("DOCENTE");
  });
});

describe("F12 · concurrencia: gana una sola decisión (criterio de aceptación)", () => {
  it("dos aprobaciones simultáneas: exactamente una responde bien y la otra 409", async () => {
    const person = await pendingPerson();

    const outcomes = await Promise.all([
      outcomeOf(world.service.approve(staff.actor, person.id, DECIDED)),
      outcomeOf(world.service.approve(staff.actor, person.id, DECIDED)),
    ]);

    expect(countOk(outcomes)).toBe(1);
    const failure = outcomes.find((outcome) => !outcome.ok);
    expect(failure?.ok === false && failure.error instanceof ConflictError).toBe(true);
    expect(await world.roleOf(person)).toBe("DOCENTE");
  });

  it("dos bibliotecarios aprobando a la vez: gana uno y queda su id", async () => {
    const other = await world.addPerson("ADMINISTRADOR");
    const person = await pendingPerson();

    const outcomes = await Promise.all([
      outcomeOf(world.service.approve(staff.actor, person.id, DECIDED)),
      outcomeOf(world.service.approve(other.actor, person.id, DECIDED)),
    ]);

    expect(countOk(outcomes)).toBe(1);
    const decidedBy = (await world.requests.get(person.id))?.decided_by;
    expect([staff.id, other.id]).toContain(decidedBy);
  });

  it("uno aprobando y otro rechazando a la vez: gana uno y el estado final es coherente con el rol", async () => {
    const other = await world.addPerson("ADMINISTRADOR");
    const person = await pendingPerson();

    const outcomes = await Promise.all([
      outcomeOf(world.service.approve(staff.actor, person.id, DECIDED)),
      outcomeOf(world.service.reject(other.actor, person.id, {}, DECIDED)),
    ]);

    expect(countOk(outcomes)).toBe(1);
    const status = (await world.requests.get(person.id))?.status;
    const role = await world.roleOf(person);
    if (status === "APROBADA") {
      expect(role).toBe("DOCENTE");
    } else {
      expect(status).toBe("RECHAZADA");
      expect(role).toBe("ESTUDIANTE");
    }
  });

  it("dos rechazos simultáneos: gana uno", async () => {
    const person = await pendingPerson();

    const outcomes = await Promise.all([
      outcomeOf(world.service.reject(staff.actor, person.id, { reason: "A" }, DECIDED)),
      outcomeOf(world.service.reject(staff.actor, person.id, { reason: "B" }, DECIDED)),
    ]);

    expect(countOk(outcomes)).toBe(1);
  });
});

describe("F11–F12 · después de rechazar, la espera de 7 días empieza en la decisión", () => {
  it("la persona rechazada no puede volver a pedir hasta 7 días después; el rechazo no se toca", async () => {
    const person = await pendingPerson();
    const rejected = await world.service.reject(staff.actor, person.id, { reason: "Falta información" }, DECIDED);

    await expect(world.ask(person, new Date(DECIDED.getTime() + 7 * DAY_MS - 1))).rejects.toThrow(ConflictError);
    expect(await world.requests.get(person.id)).toEqual(rejected);

    const again = await world.ask(person, new Date(DECIDED.getTime() + 7 * DAY_MS));
    expect(again.status).toBe("PENDIENTE");
    expect(again.reason).toBeNull();
  });
});
