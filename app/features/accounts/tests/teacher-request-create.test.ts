import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { ConflictError, ForbiddenError } from "@/shared/server/errors";
import {
  countOk,
  DAY_MS,
  makeTeacherWorld,
  NOTE,
  outcomeOf,
  T0,
  type TeacherWorld,
} from "@/tests/helpers/teacher-requests";
import { TeacherRequestSchema } from "../schema";

let world: TeacherWorld;

beforeEach(() => {
  world = makeTeacherWorld();
});

const RETRY_MESSAGE = /^Tu solicitud anterior fue rechazada; podrás volver a pedirla el .*17.*enero.*2026\.$/;

/** Una solicitud rechazada en `T0` por el bibliotecario. */
async function rejectedAtT0(role: "EXTERNO" | "ESTUDIANTE" = "ESTUDIANTE") {
  const person = await world.addPerson(role);
  const staff = await world.addPerson("BIBLIOTECARIO");
  await world.ask(person);
  await world.service.reject(staff.actor, person.id, { reason: "No pudimos comprobarlo" }, T0);
  return person;
}

describe("F11 · crear la solicitud · caso feliz (regla 6, 8 y 9)", () => {
  it.each([
    "ESTUDIANTE",
    "EXTERNO",
  ] as const)("un %s activo con correo verificado deja una solicitud PENDIENTE", async (role) => {
    const person = await world.addPerson(role);

    const created = await world.service.request(person.actor, { note: NOTE }, T0);

    expect(TeacherRequestSchema.strict().parse(created)).toEqual({
      member_id: person.id,
      note: NOTE,
      status: "PENDIENTE",
      requested_at: T0.toISOString(),
      decided_at: null,
      decided_by: null,
      reason: null,
    });
  });

  it("la solicitud no cambia el rol de la persona", async () => {
    const person = await world.addPerson("ESTUDIANTE");

    await world.ask(person);

    expect(await world.roleOf(person)).toBe("ESTUDIANTE");
  });

  it("queda guardada con el id de la persona y getMine la devuelve", async () => {
    const person = await world.addPerson("EXTERNO");

    const created = await world.ask(person);

    expect(await world.requests.get(person.id)).toEqual(created);
    expect((await world.service.getMine(person.actor)).request).toEqual(created);
  });

  it("la nota se guarda recortada", async () => {
    const person = await world.addPerson("EXTERNO");

    const created = await world.ask(person, T0, `   ${NOTE}  \n`);

    expect(created.note).toBe(NOTE);
  });

  it("la fecha de envío es la que se inyecta, no el reloj", async () => {
    const person = await world.addPerson("EXTERNO");
    const later = new Date("2030-05-06T07:08:09.000Z");

    expect((await world.ask(person, later)).requested_at).toBe("2030-05-06T07:08:09.000Z");
  });

  it("dos personas distintas pueden tener solicitud a la vez", async () => {
    const first = await world.addPerson("EXTERNO");
    const second = await world.addPerson("ESTUDIANTE");

    await world.ask(first);
    await world.ask(second);

    expect((await world.requests.list("PENDIENTE", 10)).requests).toHaveLength(2);
  });
});

describe("F11 · la nota: 10 a 500 caracteres (bordes de la regla 6)", () => {
  it.each([
    [9, false],
    [10, true],
    [11, true],
    [500, true],
    [501, false],
  ])("nota de %i caracteres: aceptada=%s", async (length, accepted) => {
    const person = await world.addPerson("ESTUDIANTE");
    const attempt = outcomeOf(world.ask(person, T0, "n".repeat(length)));

    expect((await attempt).ok).toBe(accepted);
    const stored = await world.requests.get(person.id);
    expect(stored === undefined).toBe(!accepted);
  });

  it.each([
    ["vacía", ""],
    ["solo espacios", "          "],
    ["solo saltos de línea y tabuladores", "\n\n\t\t\n\n\t\t"],
  ])("nota %s: error de validación y no se crea nada", async (_name, note) => {
    const person = await world.addPerson("ESTUDIANTE");

    await expect(world.ask(person, T0, note)).rejects.toThrow(ZodError);

    expect(await world.requests.get(person.id)).toBeUndefined();
  });

  it("sin nota: error de validación", async () => {
    const person = await world.addPerson("ESTUDIANTE");

    await expect(world.service.request(person.actor, {}, T0)).rejects.toThrow(ZodError);
  });

  it("los espacios de los extremos no cuentan: 9 caracteres con espacios alrededor se rechazan", async () => {
    const person = await world.addPerson("ESTUDIANTE");

    await expect(world.ask(person, T0, `   ${"n".repeat(9)}   `)).rejects.toThrow(ZodError);
  });

  it("los espacios de los extremos no cuentan: 10 caracteres con espacios alrededor se aceptan y se guardan recortados", async () => {
    const person = await world.addPerson("ESTUDIANTE");

    const created = await world.ask(person, T0, `   ${"n".repeat(10)}   `);

    expect(created.note).toBe("n".repeat(10));
  });

  it("500 caracteres más espacios alrededor se aceptan (el recorte va antes de contar)", async () => {
    const person = await world.addPerson("ESTUDIANTE");

    expect((await world.ask(person, T0, ` ${"n".repeat(500)} `)).note).toHaveLength(500);
  });

  it("una nota con saltos de línea cuenta cada salto como un carácter", async () => {
    const person = await world.addPerson("ESTUDIANTE");

    const created = await world.ask(person, T0, "Línea uno\nLínea dos\nLínea tres");

    expect(created.note).toBe("Línea uno\nLínea dos\nLínea tres");
  });

  it("los saltos de línea intermedios cuentan; uno final se recorta antes de contar (9 caracteres no alcanzan)", async () => {
    const person = await world.addPerson("ESTUDIANTE");

    await expect(world.ask(person, T0, "a\nb\nc\nd\ne\n")).rejects.toThrow(ZodError);
    expect((await world.ask(person, T0, "a\nb\nc\nd\ne\nf")).note).toBe("a\nb\nc\nd\ne\nf");
  });

  it("las tildes cuentan como un carácter cada una", async () => {
    const person = await world.addPerson("ESTUDIANTE");

    expect((await world.ask(person, T0, "áéíóúñÁÉÍÓ")).note).toHaveLength(10);
  });

  it("los emojis cuentan como un carácter cada uno (como los cuenta Zod): 5 emojis no alcanzan, 10 sí", async () => {
    const person = await world.addPerson("ESTUDIANTE");

    await expect(world.ask(person, T0, "😀".repeat(5))).rejects.toThrow(ZodError);
    expect((await world.ask(person, T0, "😀".repeat(10))).note).toBe("😀".repeat(10));
  });

  it("500 emojis se aceptan y 501 no", async () => {
    const person = await world.addPerson("ESTUDIANTE");

    await expect(world.ask(person, T0, "😀".repeat(501))).rejects.toThrow(ZodError);
    expect((await world.ask(person, T0, "😀".repeat(500))).note).toHaveLength(1000);
  });
});

describe("F11 · quién puede pedir y en qué orden (regla 7)", () => {
  it("un DOCENTE recibe 409 «Ya eres docente.»", async () => {
    const teacher = await world.addPerson("DOCENTE");

    const attempt = world.ask(teacher);

    await expect(attempt).rejects.toThrow(ConflictError);
    await expect(attempt).rejects.toThrow("Ya eres docente.");
    expect(await world.requests.get(teacher.id)).toBeUndefined();
  });

  it.each([
    "BIBLIOTECARIO",
    "ADMINISTRADOR",
  ] as const)("un %s recibe 403 «El personal no pide el rol de docente.»", async (role) => {
    const staff = await world.addPerson(role);

    const attempt = world.ask(staff);

    await expect(attempt).rejects.toThrow(ForbiddenError);
    await expect(attempt).rejects.toThrow("El personal no pide el rol de docente.");
    expect(await world.requests.get(staff.id)).toBeUndefined();
  });

  it("el personal con el correo sin verificar recibe el mensaje del personal, no el de verificación", async () => {
    const staff = await world.addPerson("BIBLIOTECARIO", { verified: false });

    await expect(world.ask(staff)).rejects.toThrow("El personal no pide el rol de docente.");
  });

  it("un DOCENTE con el correo sin verificar recibe «Ya eres docente.»", async () => {
    const teacher = await world.addPerson("DOCENTE", { verified: false });

    await expect(world.ask(teacher)).rejects.toThrow("Ya eres docente.");
  });

  it("con el correo sin verificar: 403 con el mensaje de verificación y no se crea nada", async () => {
    const person = await world.addPerson("ESTUDIANTE", { verified: false });

    const attempt = world.ask(person);

    await expect(attempt).rejects.toThrow(ForbiddenError);
    await expect(attempt).rejects.toThrow("Verifica tu correo para solicitar el rol de docente.");
    expect(await world.requests.get(person.id)).toBeUndefined();
  });

  it("al pulsar el enlace de verificación, el mismo actor puede pedir sin volver a ingresar", async () => {
    const person = await world.addPerson("ESTUDIANTE", { verified: false });
    await expect(world.ask(person)).rejects.toThrow(ForbiddenError);

    world.identity.markEmailVerified(person.id);

    expect((await world.ask(person)).status).toBe("PENDIENTE");
  });

  it("si el correo deja de estar verificado, vuelve el 403 (se lee en cada petición)", async () => {
    const person = await world.addPerson("ESTUDIANTE");
    world.identity.markEmailUnverified(person.id);

    await expect(world.ask(person)).rejects.toThrow("Verifica tu correo para solicitar el rol de docente.");
  });

  it("una cuenta que no existe en Firebase cuenta como no verificada", async () => {
    const attempt = world.service.request({ member_id: "uid-fantasma", role: "ESTUDIANTE" }, { note: NOTE }, T0);

    await expect(attempt).rejects.toThrow(ForbiddenError);
  });

  it("verificación antes que pendiente: sin verificar y con una solicitud viva, manda el 403", async () => {
    const person = await world.addPerson("ESTUDIANTE");
    await world.ask(person);
    world.identity.markEmailUnverified(person.id);

    await expect(world.ask(person)).rejects.toThrow(ForbiddenError);
  });

  it("con una solicitud PENDIENTE: 409 «Ya tienes una solicitud pendiente.»", async () => {
    const person = await world.addPerson("EXTERNO");
    await world.ask(person);

    const attempt = world.ask(person, new Date(T0.getTime() + DAY_MS));

    await expect(attempt).rejects.toThrow(ConflictError);
    await expect(attempt).rejects.toThrow("Ya tienes una solicitud pendiente.");
  });

  it("la solicitud pendiente original no se toca al repetir", async () => {
    const person = await world.addPerson("EXTERNO");
    const first = await world.ask(person);

    await expect(
      world.ask(person, new Date(T0.getTime() + DAY_MS), "Otra nota distinta de la primera"),
    ).rejects.toThrow(ConflictError);

    expect(await world.requests.get(person.id)).toEqual(first);
  });
});

describe("F11 · el orden de comprobaciones: la validación del cuerpo va al final (regla 7)", () => {
  const BAD = "corta";

  it("un DOCENTE con nota inválida recibe 409, no el error de validación", async () => {
    const teacher = await world.addPerson("DOCENTE");

    await expect(world.ask(teacher, T0, BAD)).rejects.toThrow(ConflictError);
  });

  it("el personal con nota inválida recibe 403, no el error de validación", async () => {
    const staff = await world.addPerson("ADMINISTRADOR");

    await expect(world.ask(staff, T0, BAD)).rejects.toThrow(ForbiddenError);
  });

  it("el correo sin verificar con nota inválida recibe 403", async () => {
    const person = await world.addPerson("ESTUDIANTE", { verified: false });

    await expect(world.ask(person, T0, BAD)).rejects.toThrow("Verifica tu correo");
  });

  it("una solicitud pendiente con nota inválida recibe 409", async () => {
    const person = await world.addPerson("ESTUDIANTE");
    await world.ask(person);

    await expect(world.ask(person, T0, BAD)).rejects.toThrow("Ya tienes una solicitud pendiente.");
  });

  it("un rechazo reciente con nota inválida recibe 409 con la fecha", async () => {
    const person = await rejectedAtT0();

    await expect(world.ask(person, T0, BAD)).rejects.toThrow(RETRY_MESSAGE);
  });

  it("si todo lo demás está en orden, la nota inválida da error de validación", async () => {
    const person = await world.addPerson("ESTUDIANTE");

    await expect(world.ask(person, T0, BAD)).rejects.toThrow(ZodError);
  });
});

describe("F11 · nueva solicitud tras un rechazo: 7 días (reglas 7.5 y 8)", () => {
  const SIX_DAYS_23H_59 = 7 * DAY_MS - 60_000;

  it("rechazada hace 0 segundos: 409 con la fecha en que podrá volver a pedirla", async () => {
    const person = await rejectedAtT0();

    const attempt = world.ask(person, T0);

    await expect(attempt).rejects.toThrow(ConflictError);
    await expect(attempt).rejects.toThrow(RETRY_MESSAGE);
  });

  it("rechazada hace 6 días 23 h 59 min: 409 con la fecha", async () => {
    const person = await rejectedAtT0();

    await expect(world.ask(person, new Date(T0.getTime() + SIX_DAYS_23H_59))).rejects.toThrow(RETRY_MESSAGE);
  });

  it("rechazada hace 7 días menos 1 milisegundo: sigue bloqueada", async () => {
    const person = await rejectedAtT0();

    await expect(world.ask(person, new Date(T0.getTime() + 7 * DAY_MS - 1))).rejects.toThrow(ConflictError);
  });

  it("el rechazo bloqueado no cambia la solicitud rechazada guardada", async () => {
    const person = await rejectedAtT0();
    const before = await world.requests.get(person.id);

    await expect(world.ask(person, new Date(T0.getTime() + SIX_DAYS_23H_59))).rejects.toThrow(ConflictError);

    expect(await world.requests.get(person.id)).toEqual(before);
  });

  it("rechazada hace exactamente 7 días: 201 y la nueva reemplaza a la anterior", async () => {
    const person = await rejectedAtT0();
    const again = new Date(T0.getTime() + 7 * DAY_MS);

    const created = await world.ask(person, again, "Nueva nota con más detalles");

    expect(created).toEqual({
      member_id: person.id,
      note: "Nueva nota con más detalles",
      status: "PENDIENTE",
      requested_at: again.toISOString(),
      decided_at: null,
      decided_by: null,
      reason: null,
    });
    expect(await world.requests.get(person.id)).toEqual(created);
  });

  it("rechazada hace 7 días y 1 milisegundo: 201", async () => {
    const person = await rejectedAtT0();

    expect((await world.ask(person, new Date(T0.getTime() + 7 * DAY_MS + 1))).status).toBe("PENDIENTE");
  });

  it("rechazada hace 30 días: 201", async () => {
    const person = await rejectedAtT0();

    expect((await world.ask(person, new Date(T0.getTime() + 30 * DAY_MS))).status).toBe("PENDIENTE");
  });

  it("no se conserva el historial: tras reemplazar, solo queda la nueva", async () => {
    const person = await rejectedAtT0();

    await world.ask(person, new Date(T0.getTime() + 8 * DAY_MS));

    expect((await world.requests.list("RECHAZADA", 10)).requests).toHaveLength(0);
    expect((await world.requests.list("PENDIENTE", 10)).requests).toHaveLength(1);
  });

  it("tras reenviar, la nueva solicitud vuelve a bloquear otro envío (está pendiente)", async () => {
    const person = await rejectedAtT0();
    await world.ask(person, new Date(T0.getTime() + 8 * DAY_MS));

    await expect(world.ask(person, new Date(T0.getTime() + 9 * DAY_MS))).rejects.toThrow(
      "Ya tienes una solicitud pendiente.",
    );
  });

  it("el plazo se cuenta desde la fecha de la decisión, no desde la del envío", async () => {
    const person = await world.addPerson("EXTERNO");
    const staff = await world.addPerson("ADMINISTRADOR");
    await world.ask(person, T0);
    const decidedAt = new Date(T0.getTime() + 10 * DAY_MS);
    await world.service.reject(staff.actor, person.id, {}, decidedAt);

    await expect(world.ask(person, new Date(decidedAt.getTime() + 6 * DAY_MS))).rejects.toThrow(ConflictError);
    expect((await world.ask(person, new Date(decidedAt.getTime() + 7 * DAY_MS))).status).toBe("PENDIENTE");
  });
});

describe("F11 · concurrencia (criterio de aceptación)", () => {
  it("dos envíos simultáneos de la misma persona: exactamente uno se crea y el otro da 409", async () => {
    const person = await world.addPerson("ESTUDIANTE");

    const outcomes = await Promise.all([outcomeOf(world.ask(person)), outcomeOf(world.ask(person))]);

    expect(countOk(outcomes)).toBe(1);
    const failure = outcomes.find((outcome) => !outcome.ok);
    expect(failure?.ok === false && failure.error instanceof ConflictError).toBe(true);
    expect((await world.requests.list("PENDIENTE", 10)).requests).toHaveLength(1);
  });

  it("cinco envíos simultáneos: uno solo se crea", async () => {
    const person = await world.addPerson("EXTERNO");

    const outcomes = await Promise.all(Array.from({ length: 5 }, () => outcomeOf(world.ask(person))));

    expect(countOk(outcomes)).toBe(1);
  });

  it("dos envíos simultáneos tras un rechazo ya reintentable: uno solo se crea", async () => {
    const person = await rejectedAtT0();
    const later = new Date(T0.getTime() + 7 * DAY_MS);

    const outcomes = await Promise.all([outcomeOf(world.ask(person, later)), outcomeOf(world.ask(person, later))]);

    expect(countOk(outcomes)).toBe(1);
  });

  it("envíos simultáneos de personas distintas se crean todos", async () => {
    const first = await world.addPerson("EXTERNO");
    const second = await world.addPerson("ESTUDIANTE");

    const outcomes = await Promise.all([outcomeOf(world.ask(first)), outcomeOf(world.ask(second))]);

    expect(countOk(outcomes)).toBe(2);
  });
});
