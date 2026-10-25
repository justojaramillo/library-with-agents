import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiErrorSchema } from "@/shared/schema";
import { resetRateLimits } from "@/shared/server/security/rate-limit";
import { DAY_MS, makeTeacherWorld, NOTE, type Person, T0, type TeacherWorld } from "@/tests/helpers/teacher-requests";
import { MyTeacherRequestSchema, TeacherRequestSchema } from "../schema";
import { GET as meRoute, POST as createRoute } from "@/api/me/teacher-request/route";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const holder = vi.hoisted(() => ({
  world: null as TeacherWorld | null,
  uid: undefined as string | undefined,
  expired: false,
}));

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => {
      if (holder.uid === undefined) {
        return undefined;
      }
      return { value: "cookie-valida" };
    },
  }),
}));

// La sesión sale de la cuenta guardada (como en producción): el rol y «activa» se leen en cada petición.
vi.mock("@/shared/server/firebase", () => ({
  getAdminAuth: () => ({
    verifySessionCookie: async () => {
      if (holder.expired || holder.uid === undefined) {
        throw Object.assign(new Error("cookie vencida"), { code: "auth/session-cookie-expired" });
      }
      return { uid: holder.uid };
    },
  }),
  getAdminDb: () => ({
    collection: () => ({
      doc: (uid: string) => ({
        get: async () => {
          const row = await holder.world?.accounts.findById(uid);
          if (row === undefined) {
            return { exists: false, data: () => undefined };
          }
          return { exists: true, data: () => ({ role: row.role, active: row.active }) };
        },
      }),
    }),
  }),
}));

vi.mock("@/features/container", () => ({
  getContainer: () => {
    if (holder.world === null) {
      throw new Error("la prueba no preparó el mundo");
    }
    return { teacherRequests: holder.world.service };
  },
}));

const JSON_HEADERS = { "content-type": "application/json", origin: "http://localhost" };

function currentWorld(): TeacherWorld {
  if (holder.world === null) {
    throw new Error("sin mundo");
  }
  return holder.world;
}

function signInAs(person: Person) {
  holder.uid = person.id;
}

function postRaw(rawBody: string, headers: Record<string, string> = {}) {
  const all: Record<string, string> = { ...JSON_HEADERS, ...headers };
  return createRoute(
    new NextRequest("http://localhost/api/me/teacher-request", { method: "POST", headers: all, body: rawBody }),
  );
}

function post(payload: Json, headers: Record<string, string> = {}) {
  return postRaw(JSON.stringify(payload), headers);
}

function postNote(note: string) {
  return post({ note });
}

function getMine() {
  return meRoute();
}

async function errorOf(response: Response): Promise<string> {
  return ApiErrorSchema.parse(await response.json()).error;
}

async function addAndSignIn(
  role: "EXTERNO" | "ESTUDIANTE" | "DOCENTE" | "BIBLIOTECARIO" | "ADMINISTRADOR",
  verified = true,
) {
  const person = await currentWorld().addPerson(role, { verified });
  signInAs(person);
  return person;
}

beforeEach(() => {
  resetRateLimits();
  holder.world = makeTeacherWorld();
  holder.uid = undefined;
  holder.expired = false;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("F11 · POST /api/me/teacher-request · caso feliz (201)", () => {
  it("un ESTUDIANTE verificado envía su nota y recibe 201 con la solicitud PENDIENTE", async () => {
    const person = await addAndSignIn("ESTUDIANTE");

    const response = await postNote("Facultad de Ciencias, Universidad del Valle");

    expect(response.status).toBe(201);
    expect(TeacherRequestSchema.strict().parse(await response.json())).toEqual({
      member_id: person.id,
      note: "Facultad de Ciencias, Universidad del Valle",
      status: "PENDIENTE",
      requested_at: T0.toISOString(),
      decided_at: null,
      decided_by: null,
      reason: null,
    });
  });

  it("un EXTERNO verificado también puede pedirlo", async () => {
    await addAndSignIn("EXTERNO");

    expect((await postNote(NOTE)).status).toBe(201);
  });

  it("la solicitud no cambia el rol de la persona", async () => {
    const person = await addAndSignIn("ESTUDIANTE");

    await postNote(NOTE);

    expect(await currentWorld().roleOf(person)).toBe("ESTUDIANTE");
  });

  it("la solicitud queda guardada y GET la devuelve", async () => {
    await addAndSignIn("ESTUDIANTE");
    await postNote(NOTE);

    const mine = MyTeacherRequestSchema.parse(await (await getMine()).json());

    expect(mine.request?.status).toBe("PENDIENTE");
    expect(mine.request?.note).toBe(NOTE);
  });

  it("la nota se guarda recortada", async () => {
    await addAndSignIn("ESTUDIANTE");

    const created = TeacherRequestSchema.parse(await (await postNote(`   ${NOTE}   `)).json());

    expect(created.note).toBe(NOTE);
  });
});

describe("F11 · la nota: 9, 10, 500 y 501 caracteres (criterio de aceptación)", () => {
  it.each([
    [9, 400],
    [10, 201],
    [500, 201],
    [501, 400],
  ])("nota de %i caracteres: %i", async (length, status) => {
    await addAndSignIn("ESTUDIANTE");

    const response = await postNote("n".repeat(length));

    expect(response.status).toBe(status);
    const mine = MyTeacherRequestSchema.parse(await (await getMine()).json());
    expect(mine.request === null).toBe(status === 400);
  });

  it.each([
    ["vacía", ""],
    ["solo espacios", "            "],
  ])("nota %s: 400 y no se crea nada", async (_name, note) => {
    await addAndSignIn("ESTUDIANTE");

    const response = await postNote(note);

    expect(response.status).toBe(400);
    expect(ApiErrorSchema.parse(await response.json()).issues?.[0]?.path).toEqual(["note"]);
    expect(MyTeacherRequestSchema.parse(await (await getMine()).json()).request).toBeNull();
  });

  it("espacios alrededor de 9 caracteres: 400; de 10 caracteres: 201", async () => {
    await addAndSignIn("ESTUDIANTE");

    expect((await postNote(`   ${"n".repeat(9)}   `)).status).toBe(400);
    expect((await postNote(`   ${"n".repeat(10)}   `)).status).toBe(201);
  });

  it("una nota con saltos de línea y tildes se acepta", async () => {
    await addAndSignIn("ESTUDIANTE");

    expect((await postNote("Línea uno\nLínea dos con acción")).status).toBe(201);
  });

  it.each([
    ["sin el campo note", {}],
    ["note nulo", { note: null }],
    ["note numérico", { note: 1234567890 }],
    ["note como arreglo", { note: ["una nota larga"] }],
    ["note como objeto", { note: { texto: "una nota larga" } }],
  ] satisfies [string, Json][])("%s: 400", async (_name, body) => {
    await addAndSignIn("ESTUDIANTE");

    expect((await post(body)).status).toBe(400);
  });
});

describe("F11 · cuerpo mal formado", () => {
  beforeEach(async () => {
    await addAndSignIn("ESTUDIANTE");
  });

  it("cuerpo vacío: 400", async () => {
    expect((await postRaw("")).status).toBe(400);
  });

  it("cuerpo que no es JSON: 400", async () => {
    expect((await postRaw("esto no es json")).status).toBe(400);
  });

  it.each(["[]", "null", '"texto"', "42"])("el JSON «%s» no es una solicitud: 400", async (raw) => {
    expect((await postRaw(raw)).status).toBe(400);
  });
});

describe("F11 · la identidad sale de la sesión; los campos extra se ignoran (regla 6)", () => {
  it("un member_id ajeno en el cuerpo se ignora: la solicitud es de la sesión", async () => {
    const owner = await addAndSignIn("ESTUDIANTE");
    const victim = await currentWorld().addPerson("EXTERNO");

    const response = await post({ note: NOTE, member_id: victim.id });

    expect(response.status).toBe(201);
    expect(TeacherRequestSchema.parse(await response.json()).member_id).toBe(owner.id);
    expect(await currentWorld().requests.get(victim.id)).toBeUndefined();
  });

  it("status APROBADA y los campos de decisión en el cuerpo se ignoran: queda PENDIENTE", async () => {
    const person = await addAndSignIn("ESTUDIANTE");

    const response = await post({
      note: NOTE,
      status: "APROBADA",
      decided_by: "uid-1",
      decided_at: T0.toISOString(),
      reason: "ya aprobada",
      requested_at: "2001-01-01T00:00:00.000Z",
      role: "DOCENTE",
    });

    expect(response.status).toBe(201);
    expect(TeacherRequestSchema.parse(await response.json())).toMatchObject({
      status: "PENDIENTE",
      decided_by: null,
      decided_at: null,
      reason: null,
      requested_at: T0.toISOString(),
    });
    expect(await currentWorld().roleOf(person)).toBe("ESTUDIANTE");
  });
});

describe("F11 · quién puede y en qué orden (regla 7)", () => {
  it("sin sesión: 401 y no se crea nada", async () => {
    const response = await postNote(NOTE);

    expect(response.status).toBe(401);
    expect(ApiErrorSchema.safeParse(await response.json()).success).toBe(true);
  });

  it("con la cookie vencida o revocada: 401", async () => {
    await addAndSignIn("ESTUDIANTE");
    holder.expired = true;

    expect((await postNote(NOTE)).status).toBe(401);
  });

  it("con la cuenta desactivada: 401", async () => {
    const person = await addAndSignIn("ESTUDIANTE");
    currentWorld().deactivate(person);

    expect((await postNote(NOTE)).status).toBe(401);
    expect(await currentWorld().requests.get(person.id)).toBeUndefined();
  });

  it("con una sesión de una cuenta que ya no existe: 401", async () => {
    holder.uid = "uid-que-no-existe";

    expect((await postNote(NOTE)).status).toBe(401);
  });

  it("un DOCENTE recibe 409 «Ya eres docente.»", async () => {
    await addAndSignIn("DOCENTE");

    const response = await postNote(NOTE);

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe("Ya eres docente.");
  });

  it.each([
    "BIBLIOTECARIO",
    "ADMINISTRADOR",
  ] as const)("un %s recibe 403 «El personal no pide el rol de docente.»", async (role) => {
    await addAndSignIn(role);

    const response = await postNote(NOTE);

    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe("El personal no pide el rol de docente.");
  });

  it("el correo sin verificar: 403 con el mensaje de verificación y no se crea nada", async () => {
    const person = await addAndSignIn("ESTUDIANTE", false);

    const response = await postNote(NOTE);

    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe("Verifica tu correo para solicitar el rol de docente.");
    expect(await currentWorld().requests.get(person.id)).toBeUndefined();
  });

  it("al pulsar el enlace de Firebase, la misma sesión repite la petición y recibe 201", async () => {
    const person = await addAndSignIn("ESTUDIANTE", false);
    expect((await postNote(NOTE)).status).toBe(403);

    currentWorld().identity.markEmailVerified(person.id);

    expect((await postNote(NOTE)).status).toBe(201);
  });

  it("una solicitud pendiente: 409 «Ya tienes una solicitud pendiente.»", async () => {
    await addAndSignIn("EXTERNO");
    expect((await postNote(NOTE)).status).toBe(201);

    const response = await postNote("Otra nota distinta de la primera");

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe("Ya tienes una solicitud pendiente.");
  });

  it.each([
    ["un DOCENTE", "DOCENTE", 409],
    ["el personal", "BIBLIOTECARIO", 403],
  ] as const)("%s con una nota inválida recibe su error de rol y no el 400", async (_name, role, status) => {
    await addAndSignIn(role);

    expect((await postNote("corta")).status).toBe(status);
  });

  it("sin verificar y con una nota inválida: 403, no 400", async () => {
    await addAndSignIn("ESTUDIANTE", false);

    expect((await postNote("corta")).status).toBe(403);
  });

  it("con una solicitud pendiente y una nota inválida: 409, no 400", async () => {
    await addAndSignIn("ESTUDIANTE");
    await postNote(NOTE);

    expect((await postNote("corta")).status).toBe(409);
  });

  it("solo con todo en orden, la nota inválida responde 400", async () => {
    await addAndSignIn("ESTUDIANTE");

    expect((await postNote("corta")).status).toBe(400);
  });
});

describe("F11 · nueva solicitud tras un rechazo (7 días)", () => {
  async function rejectedPerson(): Promise<Person> {
    const person = await addAndSignIn("ESTUDIANTE");
    const staff = await currentWorld().addPerson("BIBLIOTECARIO");
    expect((await postNote(NOTE)).status).toBe(201);
    await currentWorld().service.reject(staff.actor, person.id, { reason: "Falta soporte" }, new Date());
    return person;
  }

  it("rechazada hace 6 días 23 h 59 min: 409 con la fecha en que podrá volver a pedirla", async () => {
    await rejectedPerson();
    vi.setSystemTime(new Date(T0.getTime() + 7 * DAY_MS - 60_000));

    const response = await postNote(NOTE);

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatch(
      /^Tu solicitud anterior fue rechazada; podrás volver a pedirla el .*17.*enero.*2026\.$/,
    );
  });

  it("rechazada hace exactamente 7 días: 201 y la nueva reemplaza a la anterior", async () => {
    const person = await rejectedPerson();
    vi.setSystemTime(new Date(T0.getTime() + 7 * DAY_MS));

    const response = await postNote("Nueva nota con más detalles");

    expect(response.status).toBe(201);
    expect(TeacherRequestSchema.parse(await response.json())).toEqual({
      member_id: person.id,
      note: "Nueva nota con más detalles",
      status: "PENDIENTE",
      requested_at: new Date(T0.getTime() + 7 * DAY_MS).toISOString(),
      decided_at: null,
      decided_by: null,
      reason: null,
    });
  });

  it("rechazada hace 7 días menos 1 milisegundo: sigue en 409", async () => {
    await rejectedPerson();
    vi.setSystemTime(new Date(T0.getTime() + 7 * DAY_MS - 1));

    expect((await postNote(NOTE)).status).toBe(409);
  });
});

describe("F11 · envío doble y el cambio de rol (criterios de aceptación)", () => {
  it("dos envíos simultáneos: exactamente uno responde 201 y el otro 409", async () => {
    await addAndSignIn("ESTUDIANTE");

    const responses = await Promise.all([postNote(NOTE), postNote(NOTE)]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
  });

  it("tras la aprobación, la siguiente petición de la misma sesión ya ve el rol DOCENTE (409 «Ya eres docente.»)", async () => {
    const person = await addAndSignIn("ESTUDIANTE");
    const staff = await currentWorld().addPerson("BIBLIOTECARIO");
    expect((await postNote(NOTE)).status).toBe(201);

    await currentWorld().service.approve(staff.actor, person.id, new Date());

    const response = await postNote(NOTE);
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe("Ya eres docente.");
  });
});

describe("F11 · protección de origen (regla 10)", () => {
  it("un POST de otro origen: 403 y no se crea nada", async () => {
    const person = await addAndSignIn("ESTUDIANTE");

    const response = await post({ note: NOTE }, { origin: "https://evil.example" });

    expect(response.status).toBe(403);
    expect(await currentWorld().requests.get(person.id)).toBeUndefined();
  });

  it("Sec-Fetch-Site cross-site: 403", async () => {
    await addAndSignIn("ESTUDIANTE");

    expect((await post({ note: NOTE }, { "sec-fetch-site": "cross-site" })).status).toBe(403);
  });

  it("un cuerpo que no declara application/json (formulario entre sitios): 403", async () => {
    await addAndSignIn("ESTUDIANTE");

    const response = await postRaw(`note=${NOTE}`, { "content-type": "application/x-www-form-urlencoded" });

    expect(response.status).toBe(403);
  });

  it("el origen se comprueba antes que la sesión: otro origen sin sesión también da 403", async () => {
    const response = await post({ note: NOTE }, { origin: "https://evil.example" });

    expect(response.status).toBe(403);
  });

  it("las peticiones de otro origen no gastan el cupo de la cuenta", async () => {
    await addAndSignIn("ESTUDIANTE");
    for (let i = 0; i < 8; i += 1) {
      expect((await post({ note: NOTE }, { origin: "https://evil.example" })).status).toBe(403);
    }

    expect((await postNote(NOTE)).status).toBe(201);
  });
});

describe("F11 · límite de tasa: 5 por hora por cuenta (regla 10)", () => {
  it("las 5 primeras peticiones pasan y la 6.ª recibe 429 con Retry-After", async () => {
    await addAndSignIn("ESTUDIANTE");
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      statuses.push((await postNote(NOTE)).status);
    }
    expect(statuses).toEqual([201, 409, 409, 409, 409]);

    const response = await postNote(NOTE);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("3600");
    expect(ApiErrorSchema.safeParse(await response.json()).success).toBe(true);
  });

  it("otra cuenta no se ve afectada por una cuenta agotada", async () => {
    await addAndSignIn("ESTUDIANTE");
    for (let i = 0; i < 6; i += 1) {
      await postNote(NOTE);
    }
    expect((await postNote(NOTE)).status).toBe(429);

    await addAndSignIn("EXTERNO");

    expect((await postNote(NOTE)).status).toBe(201);
  });

  it("el límite va antes de leer el cuerpo: agotado el cupo, un cuerpo roto responde 429 y no 400", async () => {
    await addAndSignIn("ESTUDIANTE");
    for (let i = 0; i < 5; i += 1) {
      await postNote(NOTE);
    }

    expect((await postRaw("no es json")).status).toBe(429);
  });

  it("los envíos inválidos (400) también gastan el cupo", async () => {
    await addAndSignIn("ESTUDIANTE");
    for (let i = 0; i < 5; i += 1) {
      expect((await postNote("corta")).status).toBe(400);
    }

    expect((await postNote(NOTE)).status).toBe(429);
  });

  it("las peticiones sin sesión no gastan el cupo de nadie", async () => {
    const person = await currentWorld().addPerson("ESTUDIANTE");
    for (let i = 0; i < 10; i += 1) {
      expect((await postNote(NOTE)).status).toBe(401);
    }
    signInAs(person);

    expect((await postNote(NOTE)).status).toBe(201);
  });

  it("pasada la hora vuelve a aceptar; un milisegundo antes todavía rechaza", async () => {
    await addAndSignIn("ESTUDIANTE");
    for (let i = 0; i < 6; i += 1) {
      await postNote(NOTE);
    }

    vi.setSystemTime(new Date(T0.getTime() + 3_600_000 - 1));
    expect((await postNote(NOTE)).status).toBe(429);

    vi.setSystemTime(new Date(T0.getTime() + 3_600_000));
    expect((await postNote(NOTE)).status).toBe(409);
  });
});

describe("F11 · GET /api/me/teacher-request (regla 11)", () => {
  it("sin sesión: 401", async () => {
    const response = await getMine();

    expect(response.status).toBe(401);
    expect(ApiErrorSchema.safeParse(await response.json()).success).toBe(true);
  });

  it("con la cuenta desactivada: 401", async () => {
    const person = await addAndSignIn("ESTUDIANTE");
    currentWorld().deactivate(person);

    expect((await getMine()).status).toBe(401);
  });

  it("sin solicitud y sin verificar: request null y email_verified false", async () => {
    await addAndSignIn("ESTUDIANTE", false);

    const response = await getMine();

    expect(response.status).toBe(200);
    expect(MyTeacherRequestSchema.strict().parse(await response.json())).toEqual({
      request: null,
      email_verified: false,
    });
  });

  it("al verificar el correo, la siguiente lectura devuelve email_verified true", async () => {
    const person = await addAndSignIn("ESTUDIANTE", false);
    currentWorld().identity.markEmailVerified(person.id);

    expect(MyTeacherRequestSchema.parse(await (await getMine()).json()).email_verified).toBe(true);
  });

  it("devuelve solo la solicitud de la sesión, no la de otra persona", async () => {
    const other = await currentWorld().addPerson("EXTERNO");
    await currentWorld().ask(other);
    await addAndSignIn("ESTUDIANTE");

    expect(MyTeacherRequestSchema.parse(await (await getMine()).json()).request).toBeNull();
  });

  it.each(["BIBLIOTECARIO", "ADMINISTRADOR"] as const)("el %s recibe request null", async (role) => {
    await addAndSignIn(role);

    const response = await getMine();

    expect(response.status).toBe(200);
    expect(MyTeacherRequestSchema.parse(await response.json()).request).toBeNull();
  });

  it("un DOCENTE aprobado recibe su solicitud APROBADA", async () => {
    const person = await addAndSignIn("ESTUDIANTE");
    const staff = await currentWorld().addPerson("BIBLIOTECARIO");
    await postNote(NOTE);
    await currentWorld().service.approve(staff.actor, person.id, new Date());

    const mine = MyTeacherRequestSchema.parse(await (await getMine()).json());

    expect(mine.request).toMatchObject({ status: "APROBADA", decided_by: staff.id });
  });
});
