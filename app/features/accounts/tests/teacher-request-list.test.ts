import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { ForbiddenError } from "@/shared/server/errors";
import { DAY_MS, makeTeacherWorld, NOTE, type Person, T0, type TeacherWorld } from "@/tests/helpers/teacher-requests";
import {
  ListTeacherRequestsQuerySchema,
  MyTeacherRequestSchema,
  TeacherRequestPageSchema,
  type ListTeacherRequestsQuery,
} from "../schema";

let world: TeacherWorld;
let staff: Person;

beforeEach(async () => {
  world = makeTeacherWorld();
  staff = await world.addPerson("BIBLIOTECARIO");
});

/** Consulta ya validada con el contrato: lo que no se indica toma los valores por defecto. */
function query(over: { status?: string; limit?: string; after?: string } = {}): ListTeacherRequestsQuery {
  return ListTeacherRequestsQuerySchema.parse(over);
}

/** `count` personas con solicitud, la primera enviada en `T0` y cada una un minuto después de la anterior. */
async function pendingPeople(count: number): Promise<Person[]> {
  const people: Person[] = [];
  for (let i = 0; i < count; i += 1) {
    const person = await world.addPerson("EXTERNO");
    await world.ask(person, new Date(T0.getTime() + i * 60_000));
    people.push(person);
  }
  return people;
}

describe("F11 · getMine · la solicitud propia (regla 11)", () => {
  it("sin solicitud: request null y el estado del correo", async () => {
    const person = await world.addPerson("ESTUDIANTE", { verified: false });

    expect(await world.service.getMine(person.actor)).toEqual({ request: null, email_verified: false });
  });

  it("con el correo verificado: email_verified true", async () => {
    const person = await world.addPerson("ESTUDIANTE");

    expect((await world.service.getMine(person.actor)).email_verified).toBe(true);
  });

  it("devuelve la solicitud de la sesión", async () => {
    const person = await world.addPerson("EXTERNO");
    const created = await world.ask(person);

    const mine = MyTeacherRequestSchema.strict().parse(await world.service.getMine(person.actor));

    expect(mine).toEqual({ request: created, email_verified: true });
  });

  it("no devuelve la solicitud de otra persona", async () => {
    const owner = await world.addPerson("EXTERNO");
    const other = await world.addPerson("ESTUDIANTE");
    await world.ask(owner);

    expect((await world.service.getMine(other.actor)).request).toBeNull();
  });

  it("un cambio en la verificación del correo se ve en la siguiente lectura", async () => {
    const person = await world.addPerson("EXTERNO", { verified: false });
    expect((await world.service.getMine(person.actor)).email_verified).toBe(false);

    world.identity.markEmailVerified(person.id);

    expect((await world.service.getMine(person.actor)).email_verified).toBe(true);
  });

  it.each(["BIBLIOTECARIO", "ADMINISTRADOR"] as const)("el %s recibe request null", async (role) => {
    const member = await world.addPerson(role);

    expect((await world.service.getMine(member.actor)).request).toBeNull();
  });

  it("un DOCENTE aprobado ve su solicitud APROBADA", async () => {
    const person = await world.addPerson("ESTUDIANTE");
    await world.ask(person);
    const approved = await world.service.approve(staff.actor, person.id, T0);

    expect((await world.service.getMine({ member_id: person.id, role: "DOCENTE" })).request).toEqual(approved);
  });
});

describe("F12 · listar · quién puede (regla 12)", () => {
  it.each(["EXTERNO", "ESTUDIANTE", "DOCENTE"] as const)("un %s no puede listar: 403", async (role) => {
    const person = await world.addPerson(role);

    await expect(world.service.list(person.actor, query())).rejects.toThrow(ForbiddenError);
  });

  it("el dueño de una solicitud tampoco puede listarla", async () => {
    const owner = await world.addPerson("EXTERNO");
    await world.ask(owner);

    await expect(world.service.list(owner.actor, query())).rejects.toThrow(ForbiddenError);
  });

  it.each(["BIBLIOTECARIO", "ADMINISTRADOR"] as const)("el %s puede listar", async (role) => {
    const member = await world.addPerson(role);

    expect((await world.service.list(member.actor, query())).requests).toEqual([]);
  });
});

describe("F12 · listar · contenido y orden (regla 12)", () => {
  it("cada elemento lleva nombre, correo, rol y correo verificado de la cuenta", async () => {
    const verified = await world.addPerson("ESTUDIANTE", { name: "Ana Verificada" });
    const unverified = await world.addPerson("EXTERNO", { name: "Beto Sin Verificar" });
    await world.ask(verified, T0);
    await world.ask(unverified, new Date(T0.getTime() + 1000));
    world.identity.markEmailUnverified(unverified.id);

    const page = TeacherRequestPageSchema.strict().parse(await world.service.list(staff.actor, query()));

    expect(page.requests).toHaveLength(2);
    expect(page.requests[0]).toMatchObject({
      member_id: verified.id,
      member_name: "Ana Verificada",
      member_email: verified.email,
      member_role: "ESTUDIANTE",
      email_verified: true,
      status: "PENDIENTE",
      note: NOTE,
    });
    expect(page.requests[1]).toMatchObject({
      member_id: unverified.id,
      member_name: "Beto Sin Verificar",
      member_email: unverified.email,
      member_role: "EXTERNO",
      email_verified: false,
    });
  });

  it("el correo verificado se lee al listar: si cambia, el listado lo refleja", async () => {
    const person = await world.addPerson("EXTERNO");
    await world.ask(person);
    expect((await world.service.list(staff.actor, query())).requests[0]?.email_verified).toBe(true);

    world.identity.markEmailUnverified(person.id);

    expect((await world.service.list(staff.actor, query())).requests[0]?.email_verified).toBe(false);
  });

  it("ordena de la más antigua a la más reciente", async () => {
    const late = await world.addPerson("EXTERNO");
    const early = await world.addPerson("EXTERNO");
    const middle = await world.addPerson("EXTERNO");
    await world.ask(late, new Date(T0.getTime() + 2 * DAY_MS));
    await world.ask(early, T0);
    await world.ask(middle, new Date(T0.getTime() + DAY_MS));

    const page = await world.service.list(staff.actor, query());

    expect(page.requests.map((item) => item.member_id)).toEqual([early.id, middle.id, late.id]);
  });

  it("a igual fecha de envío desempata por id", async () => {
    const people = await pendingPeople(0);
    for (let i = 0; i < 4; i += 1) {
      const person = await world.addPerson("EXTERNO");
      await world.ask(person, T0);
      people.push(person);
    }

    const page = await world.service.list(staff.actor, query());

    const expected = people.map((person) => person.id).sort();
    expect(page.requests.map((item) => item.member_id)).toEqual(expected);
  });

  it("por defecto solo lista las PENDIENTES", async () => {
    const [pending, approved, rejected] = await pendingPeople(3);
    await world.service.approve(staff.actor, approved?.id ?? "", T0);
    await world.service.reject(staff.actor, rejected?.id ?? "", {}, T0);

    const page = await world.service.list(staff.actor, query());

    expect(page.requests.map((item) => item.member_id)).toEqual([pending?.id]);
  });

  it("status APROBADA y status RECHAZADA listan solo las de ese estado", async () => {
    const [, approved, rejected] = await pendingPeople(3);
    await world.service.approve(staff.actor, approved?.id ?? "", T0);
    await world.service.reject(staff.actor, rejected?.id ?? "", { reason: "No" }, T0);

    const approvedPage = await world.service.list(staff.actor, query({ status: "APROBADA" }));
    const rejectedPage = await world.service.list(staff.actor, query({ status: "RECHAZADA" }));

    expect(approvedPage.requests.map((item) => item.member_id)).toEqual([approved?.id]);
    expect(approvedPage.requests[0]?.member_role).toBe("DOCENTE");
    expect(rejectedPage.requests.map((item) => item.member_id)).toEqual([rejected?.id]);
    expect(rejectedPage.requests[0]?.reason).toBe("No");
  });

  it("una cuenta cuya persona ya no existe se omite sin fallar", async () => {
    const [present] = await pendingPeople(1);
    await world.requests.create(
      {
        member_id: "cuenta-borrada",
        note: NOTE,
        status: "PENDIENTE",
        requested_at: new Date(T0.getTime() - DAY_MS).toISOString(),
        decided_at: null,
        decided_by: null,
        reason: null,
      },
      new Date(T0.getTime() - 8 * DAY_MS),
    );

    const page = await world.service.list(staff.actor, query());

    expect(page.requests.map((item) => item.member_id)).toEqual([present?.id]);
  });
});

describe("F12 · listar · paginación (bordes 0, 1, 50, 51)", () => {
  it("0 solicitudes: lista vacía y next_after null", async () => {
    expect(await world.service.list(staff.actor, query())).toEqual({ requests: [], next_after: null });
  });

  it("1 solicitud: una y next_after null", async () => {
    const [only] = await pendingPeople(1);

    const page = await world.service.list(staff.actor, query());

    expect(page.requests.map((item) => item.member_id)).toEqual([only?.id]);
    expect(page.next_after).toBeNull();
  });

  it("50 solicitudes con el límite por defecto: caben en una página, sin next_after", async () => {
    await pendingPeople(50);

    const page = await world.service.list(staff.actor, query());

    expect(page.requests).toHaveLength(50);
    expect(page.next_after).toBeNull();
  });

  it("51 solicitudes: la primera página trae 50 y next_after es la última; la segunda trae 1 y no tiene cursor", async () => {
    const people = await pendingPeople(51);

    const first = await world.service.list(staff.actor, query());
    const second = await world.service.list(staff.actor, query({ after: first.next_after ?? "" }));

    expect(first.requests).toHaveLength(50);
    expect(first.next_after).toBe(first.requests[49]?.member_id);
    expect(second.requests.map((item) => item.member_id)).toEqual([people[50]?.id]);
    expect(second.next_after).toBeNull();
  });

  it("limit 1 con 3 solicitudes recorre una por una sin repetir ni saltar", async () => {
    const people = await pendingPeople(3);

    const seen: string[] = [];
    let after: string | undefined;
    for (let guard = 0; guard < 5; guard += 1) {
      const page = await world.service.list(staff.actor, query({ limit: "1", after }));
      seen.push(...page.requests.map((item) => item.member_id));
      if (page.next_after === null) {
        break;
      }
      after = page.next_after;
    }

    expect(seen).toEqual(people.map((person) => person.id));
  });

  it("limit igual al total no deja cursor; limit uno menos sí", async () => {
    await pendingPeople(3);

    expect((await world.service.list(staff.actor, query({ limit: "3" }))).next_after).toBeNull();
    expect((await world.service.list(staff.actor, query({ limit: "2" }))).next_after).not.toBeNull();
  });

  it("un after que no corresponde a ninguna solicitud es un error de validación (400)", async () => {
    await pendingPeople(1);

    await expect(world.service.list(staff.actor, query({ after: "desconocido" }))).rejects.toThrow(ZodError);
  });

  it("el cursor sigue valiendo aunque esa solicitud ya se haya resuelto", async () => {
    const people = await pendingPeople(3);
    const first = await world.service.list(staff.actor, query({ limit: "1" }));
    await world.service.approve(staff.actor, people[0]?.id ?? "", T0);

    const second = await world.service.list(staff.actor, query({ after: first.next_after ?? "" }));

    expect(second.requests.map((item) => item.member_id)).toEqual([people[1]?.id, people[2]?.id]);
  });
});

describe("F12 · el contrato de la consulta", () => {
  it("por defecto: status PENDIENTE y limit 50", () => {
    expect(ListTeacherRequestsQuerySchema.parse({})).toEqual({ status: "PENDIENTE", limit: 50 });
  });

  it.each(["pendiente", "PENDING", "", "TODAS"])("el status «%s» no es válido", (status) => {
    expect(ListTeacherRequestsQuerySchema.safeParse({ status }).success).toBe(false);
  });

  it.each([
    ["0", false],
    ["1", true],
    ["100", true],
    ["101", false],
    ["-1", false],
    ["2.5", false],
    ["abc", false],
  ])("limit %s: válido=%s", (limit, valid) => {
    expect(ListTeacherRequestsQuerySchema.safeParse({ limit }).success).toBe(valid);
  });
});
