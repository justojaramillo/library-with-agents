import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiErrorSchema, type Role } from "@/shared/schema";
import { resetRateLimits } from "@/shared/server/security/rate-limit";
import { emailOfLength, makeStaffWorld, PASSWORD, type StaffPerson, type StaffWorld } from "@/tests/helpers/staff";
import { MemberSchema } from "../schema";
import { GET as listRoute, POST as createRoute } from "@/api/staff/route";
import { POST as registerMemberRoute } from "@/api/members/route";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const holder = vi.hoisted(() => ({
  world: null as StaffWorld | null,
  cookie: undefined as string | undefined,
}));

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => {
      if (holder.cookie === undefined) {
        return undefined;
      }
      return { value: holder.cookie };
    },
  }),
}));

// La sesión real: la cookie la emite la identidad en memoria y el rol y el estado se leen de la cuenta guardada.
vi.mock("@/shared/server/firebase", () => ({
  getAdminAuth: () => ({
    verifySessionCookie: async (cookie: string) => {
      const verified = await holder.world?.identity.verifySessionCookie(cookie);
      if (!verified) {
        throw Object.assign(new Error("sin sesión"), { code: "auth/invalid-session-cookie" });
      }
      return verified;
    },
  }),
  getAdminDb: () => ({
    collection: () => ({
      doc: (uid: string) => ({
        get: async () => {
          const row = await holder.world?.repos.members.findById(uid);
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
    const { create, list, setActive } = holder.world.staff;
    return { staff: { create, list, setActive }, members: holder.world.members };
  },
}));

const T0 = new Date("2026-01-10T10:00:00.000Z");
const JSON_HEADERS = { "content-type": "application/json", origin: "http://localhost" };

function currentWorld(): StaffWorld {
  if (holder.world === null) {
    throw new Error("sin mundo");
  }
  return holder.world;
}

async function signInAs(role: Role): Promise<StaffPerson> {
  const person = await currentWorld().addPerson(role);
  holder.cookie = await currentWorld().sessionCookieFor(person);
  return person;
}

function valid(over: { [key: string]: Json } = {}): { [key: string]: Json } {
  return { name: "Lucía Fernández", email: "lucia@example.com", password: PASSWORD, ...over };
}

function postRaw(rawBody: string | null, headers: Record<string, string> = JSON_HEADERS) {
  const init: { method: string; headers: Record<string, string>; body?: string } = { method: "POST", headers };
  if (rawBody !== null) {
    init.body = rawBody;
  }
  return createRoute(new NextRequest("http://localhost/api/staff", init));
}

function post(payload: Json) {
  return postRaw(JSON.stringify(payload));
}

function list() {
  return listRoute();
}

async function accountCount(): Promise<number> {
  return (await currentWorld().repos.members.list(500)).members.length;
}

async function errorOf(response: Response): Promise<string> {
  return ApiErrorSchema.parse(await response.json()).error;
}

beforeEach(() => {
  resetRateLimits();
  holder.world = makeStaffWorld();
  holder.cookie = undefined;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("F13 · POST /api/staff · caso feliz (reglas 1 y 3)", () => {
  it("el administrador crea un bibliotecario: 201, BIBLIOTECARIO y activo", async () => {
    await signInAs("ADMINISTRADOR");

    const response = await post(valid());

    expect(response.status).toBe(201);
    expect(MemberSchema.strict().parse(await response.json())).toMatchObject({
      name: "Lucía Fernández",
      email: "lucia@example.com",
      role: "BIBLIOTECARIO",
      active: true,
    });
  });

  it("la cuenta nueva existe y la persona puede ingresar con la contraseña elegida", async () => {
    await signInAs("ADMINISTRADOR");
    const created = MemberSchema.parse(await (await post(valid())).json());

    expect((await currentWorld().repos.members.findById(created.id))?.role).toBe("BIBLIOTECARIO");
    const idToken = await currentWorld().identity.signIn("lucia@example.com", PASSWORD);
    expect(idToken).not.toBeNull();
    expect((await currentWorld().auth.login({ id_token: idToken ?? "" })).member.id).toBe(created.id);
  });

  it("la respuesta no contiene la contraseña ni campos internos", async () => {
    await signInAs("ADMINISTRADOR");

    const text = await (await post(valid())).text();

    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain("search_keys");
    expect(text).not.toContain("password");
  });

  it("no cambia la sesión de quien la crea: la respuesta no fija ninguna cookie", async () => {
    await signInAs("ADMINISTRADOR");

    expect((await post(valid())).headers.get("set-cookie")).toBeNull();
  });

  it.each([
    "ADMINISTRADOR",
    "DOCENTE",
    "EXTERNO",
    "ESTUDIANTE",
  ])("role «%s» en el cuerpo se ignora: la cuenta es BIBLIOTECARIO", async (role) => {
    await signInAs("ADMINISTRADOR");

    const response = await post(valid({ role }));

    expect(response.status).toBe(201);
    expect(MemberSchema.parse(await response.json()).role).toBe("BIBLIOTECARIO");
  });

  it("campos extra (active, id, is_admin) se ignoran", async () => {
    await signInAs("ADMINISTRADOR");

    const response = await post(valid({ active: false, id: "mio", is_admin: true, role: ["X"] }));

    expect(response.status).toBe(201);
    const member = MemberSchema.parse(await response.json());
    expect(member).toMatchObject({ role: "BIBLIOTECARIO", active: true });
    expect(member.id).not.toBe("mio");
  });

  it("guarda el correo recortado y en minúsculas", async () => {
    await signInAs("ADMINISTRADOR");

    const member = MemberSchema.parse(await (await post(valid({ email: "  LUCIA@Example.COM " }))).json());

    expect(member.email).toBe("lucia@example.com");
  });
});

describe("F13 · POST /api/staff · autorización y origen (regla 2)", () => {
  it("sin sesión: 401 y no se crea nada", async () => {
    const response = await post(valid());

    expect(response.status).toBe(401);
    expect(ApiErrorSchema.safeParse(await response.json()).success).toBe(true);
    expect(await accountCount()).toBe(0);
  });

  it("sin sesión y con cuerpo inválido: 401", async () => {
    expect((await postRaw("esto no es json")).status).toBe(401);
  });

  it.each([
    "BIBLIOTECARIO",
    "EXTERNO",
    "ESTUDIANTE",
    "DOCENTE",
  ] satisfies Role[])("un %s recibe 403 «Solo el administrador crea bibliotecarios.» y no se crea nada", async (role) => {
    await signInAs(role);
    const before = await accountCount();

    const response = await post(valid());

    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe("Solo el administrador crea bibliotecarios.");
    expect(await accountCount()).toBe(before);
    expect(await currentWorld().identity.signIn("lucia@example.com", PASSWORD)).toBeNull();
  });

  it.each([
    "BIBLIOTECARIO",
    "ESTUDIANTE",
  ] satisfies Role[])("un %s recibe 403 aunque el cuerpo sea basura (la autorización va antes que la validación)", async (role) => {
    await signInAs(role);

    expect((await postRaw("esto no es json")).status).toBe(403);
    expect((await postRaw("")).status).toBe(403);
    expect((await post({ name: 5, email: null, password: [] })).status).toBe(403);
    expect((await post(valid({ password: "corta" }))).status).toBe(403);
    expect((await post([])).status).toBe(403);
  });

  it("un bibliotecario no se asciende ni crea un administrador enviando role ADMINISTRADOR", async () => {
    const librarian = await signInAs("BIBLIOTECARIO");

    const response = await post(valid({ role: "ADMINISTRADOR" }));

    expect(response.status).toBe(403);
    expect((await currentWorld().stored(librarian))?.role).toBe("BIBLIOTECARIO");
  });

  it("una petición de otro origen: 403 aunque el administrador tenga sesión, y no se crea nada", async () => {
    await signInAs("ADMINISTRADOR");
    const before = await accountCount();

    const response = await postRaw(JSON.stringify(valid()), { ...JSON_HEADERS, origin: "https://evil.example" });

    expect(response.status).toBe(403);
    expect(await accountCount()).toBe(before);
  });

  it("Sec-Fetch-Site cross-site: 403", async () => {
    await signInAs("ADMINISTRADOR");

    const response = await postRaw(JSON.stringify(valid()), { ...JSON_HEADERS, "sec-fetch-site": "cross-site" });

    expect(response.status).toBe(403);
  });

  it("un cuerpo que no declara application/json: 403", async () => {
    await signInAs("ADMINISTRADOR");

    const response = await postRaw("name=Ana&email=ana@example.com&password=clave-segura-123", {
      origin: "http://localhost",
      "content-type": "application/x-www-form-urlencoded",
    });

    expect(response.status).toBe(403);
  });

  it("el origen se comprueba antes que la sesión: otro origen sin sesión da 403, no 401", async () => {
    const response = await postRaw(JSON.stringify(valid()), { ...JSON_HEADERS, origin: "https://evil.example" });

    expect(response.status).toBe(403);
  });

  it("una cuenta de administrador desactivada ya no tiene sesión: 401", async () => {
    const admin = await signInAs("ADMINISTRADOR");
    await currentWorld().repos.members.setActive(admin.id, false);

    expect((await post(valid())).status).toBe(401);
  });

  it("una cookie que no emitió nuestra identidad: 401", async () => {
    holder.cookie = "cookie-falsa";

    expect((await post(valid())).status).toBe(401);
  });
});

describe("F13 · POST /api/staff · correo repetido (409)", () => {
  it("el mismo correo otra vez: 409 «Ya existe una cuenta con ese correo.» y sin segunda cuenta", async () => {
    await signInAs("ADMINISTRADOR");
    await post(valid());
    const before = await accountCount();

    const response = await post(valid({ name: "Otra" }));

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe("Ya existe una cuenta con ese correo.");
    expect(await accountCount()).toBe(before);
  });

  it.each([
    "LUCIA@EXAMPLE.COM",
    "  lucia@example.com  ",
    " Lucia@Example.Com ",
  ])("el mismo correo escrito como «%s»: 409", async (email) => {
    await signInAs("ADMINISTRADOR");
    await post(valid());

    expect((await post(valid({ email }))).status).toBe(409);
  });

  it("el correo de una cuenta de otro rol también da 409", async () => {
    const admin = await signInAs("ADMINISTRADOR");

    expect((await post(valid({ email: admin.email }))).status).toBe(409);
  });

  it("dos altas simultáneas con el mismo correo: una 201 y otra 409, una sola cuenta nueva", async () => {
    await signInAs("ADMINISTRADOR");
    const before = await accountCount();

    const responses = await Promise.all([post(valid()), post(valid({ name: "Gemela" }))]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await accountCount()).toBe(before + 1);
  });
});

describe("F13 · POST /api/staff · validación (400, bordes)", () => {
  beforeEach(async () => {
    await signInAs("ADMINISTRADOR");
  });

  it.each([
    [7, 400],
    [8, 201],
    [100, 201],
    [101, 400],
  ])("contraseña de %i caracteres: %i", async (length, status) => {
    const response = await post(valid({ password: "p".repeat(length) }));

    expect(response.status).toBe(status);
  });

  it.each([
    [1, 201],
    [120, 201],
    [121, 400],
  ])("nombre de %i caracteres: %i", async (length, status) => {
    expect((await post(valid({ name: "n".repeat(length) }))).status).toBe(status);
  });

  it("nombre solo con espacios: 400", async () => {
    const before = await accountCount();

    expect((await post(valid({ name: "     " }))).status).toBe(400);
    expect(await accountCount()).toBe(before);
  });

  it("el nombre se guarda recortado", async () => {
    const member = MemberSchema.parse(await (await post(valid({ name: "  Lucía  " }))).json());

    expect(member.name).toBe("Lucía");
  });

  it.each([
    [254, 201],
    [255, 400],
  ])("correo de %i caracteres: %i", async (length, status) => {
    expect((await post(valid({ email: emailOfLength(length) }))).status).toBe(status);
  });

  it.each(["no-es-correo", "lucia@", "@example.com", ""])("correo «%s»: 400", async (email) => {
    expect((await post(valid({ email }))).status).toBe(400);
  });

  it.each([
    ["sin nombre", { email: "a@example.com", password: PASSWORD }],
    ["sin correo", { name: "Ana", password: PASSWORD }],
    ["sin contraseña", { name: "Ana", email: "a@example.com" }],
    ["nombre numérico", { name: 5, email: "a@example.com", password: PASSWORD }],
    ["contraseña nula", { name: "Ana", email: "a@example.com", password: null }],
    ["correo como arreglo", { name: "Ana", email: ["a@example.com"], password: PASSWORD }],
  ] satisfies [string, Json][])("%s: 400", async (_name, body) => {
    const before = await accountCount();

    const response = await post(body);

    expect(response.status).toBe(400);
    expect(ApiErrorSchema.safeParse(await response.json()).success).toBe(true);
    expect(await accountCount()).toBe(before);
  });

  it("cuerpo vacío: 400", async () => {
    expect((await postRaw("")).status).toBe(400);
  });

  it("sin cuerpo ni Content-Type: 400", async () => {
    expect((await postRaw(null, { origin: "http://localhost" })).status).toBe(400);
  });

  it("cuerpo que no es JSON: 400", async () => {
    expect((await postRaw("esto no es json")).status).toBe(400);
  });

  it.each(["{}", "[]", "null", '"texto"', "42"])("el JSON «%s» no es un alta: 400", async (raw) => {
    expect((await postRaw(raw)).status).toBe(400);
  });
});

describe("F13 · POST /api/staff · si guardar falla (500)", () => {
  it("responde 500 sin filtrar el detalle y el correo puede volver a usarse", async () => {
    await signInAs("ADMINISTRADOR");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const spy = vi.spyOn(currentWorld().repos.members, "create").mockRejectedValueOnce(new Error("Firestore caído"));

    const failed = await post(valid({ email: "caida@example.com" }));

    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain("Firestore");
    expect(await currentWorld().identity.signIn("caida@example.com", PASSWORD)).toBeNull();

    spy.mockRestore();
    expect((await post(valid({ email: "caida@example.com" }))).status).toBe(201);
  });
});

describe("F13 · GET /api/staff (regla 12)", () => {
  it("sin sesión: 401", async () => {
    expect((await list()).status).toBe(401);
  });

  it.each([
    "BIBLIOTECARIO",
    "EXTERNO",
    "ESTUDIANTE",
    "DOCENTE",
  ] satisfies Role[])("un %s recibe 403 «Solo el administrador ve el personal.»", async (role) => {
    await signInAs(role);

    const response = await list();

    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe("Solo el administrador ve el personal.");
  });

  it("una cuenta desactivada recibe 401", async () => {
    const admin = await signInAs("ADMINISTRADOR");
    await currentWorld().repos.members.setActive(admin.id, false);

    expect((await list()).status).toBe(401);
  });

  it("el administrador sin bibliotecarios ve solo su propia cuenta", async () => {
    const admin = await signInAs("ADMINISTRADOR");

    const response = await list();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { id: admin.id, name: admin.name, email: admin.email, role: "ADMINISTRADOR", active: true },
    ]);
  });

  it("lista bibliotecarios y administrador, con estado, sin prestatarios y sin contraseñas", async () => {
    await signInAs("ADMINISTRADOR");
    const librarian = await currentWorld().addWithState("BIBLIOTECARIO", false);
    await currentWorld().addPerson("ESTUDIANTE");
    await currentWorld().addPerson("DOCENTE");

    const text = await (await list()).text();
    const members = MemberSchema.strict().array().parse(JSON.parse(text));

    expect(members).toHaveLength(2);
    expect(members.find((member) => member.id === librarian.id)).toMatchObject({
      role: "BIBLIOTECARIO",
      active: false,
    });
    expect(members.map((member) => member.role).sort()).toEqual(["ADMINISTRADOR", "BIBLIOTECARIO"]);
    expect(text).not.toContain("password");
    expect(text).not.toContain(PASSWORD);
  });

  it("los ordena por nombre en español (tildes, mayúsculas y Ñ)", async () => {
    await signInAs("ADMINISTRADOR");
    const names = ["Ñoño", "Álvaro", "zoe", "Nora", "Ana"];
    for (const name of names) {
      await currentWorld().addPerson("BIBLIOTECARIO", { name });
    }

    const members = MemberSchema.array().parse(await (await list()).json());

    expect(members.map((member) => member.name).filter((name) => names.includes(name))).toEqual([
      "Álvaro",
      "Ana",
      "Nora",
      "Ñoño",
      "zoe",
    ]);
  });

  it("la cuenta recién creada por POST aparece en el siguiente GET", async () => {
    await signInAs("ADMINISTRADOR");
    const created = MemberSchema.parse(await (await post(valid())).json());

    const members = MemberSchema.array().parse(await (await list()).json());

    expect(members.map((member) => member.id)).toContain(created.id);
  });

  it("con más de 200 cuentas de personal devuelve 200", async () => {
    await signInAs("ADMINISTRADOR");
    for (let i = 0; i < 210; i += 1) {
      await currentWorld().repos.members.create({
        id: `bib-${i}`,
        name: `Persona ${String(i).padStart(3, "0")}`,
        email: `bib-${i}@example.com`,
        role: "BIBLIOTECARIO",
        active: true,
      });
    }

    const members = MemberSchema.array().parse(await (await list()).json());

    expect(members).toHaveLength(200);
  });
});

describe("F13 · POST /api/members (F3) sigue sin crear personal (regla 5)", () => {
  function registerAs(role: Json) {
    return registerMemberRoute(
      new NextRequest("http://localhost/api/members", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: "Ana Gómez", email: "ana@example.com", password: PASSWORD, role }),
      }),
    );
  }

  it.each([
    "BIBLIOTECARIO",
    "ADMINISTRADOR",
    "DOCENTE",
  ])("un administrador que pide role %s: 400 y no se crea cuenta", async (role) => {
    await signInAs("ADMINISTRADOR");
    const before = await accountCount();

    const response = await registerAs(role);

    expect(response.status).toBe(400);
    expect(await accountCount()).toBe(before);
    expect(await currentWorld().identity.signIn("ana@example.com", PASSWORD)).toBeNull();
  });

  it.each([
    "BIBLIOTECARIO",
    "ADMINISTRADOR",
    "DOCENTE",
  ])("un bibliotecario que pide role %s: 400 y no se crea cuenta", async (role) => {
    await signInAs("BIBLIOTECARIO");

    expect((await registerAs(role)).status).toBe(400);
  });

  it.each(["EXTERNO", "ESTUDIANTE"])("los roles de prestatario siguen permitidos (%s): 201", async (role) => {
    await signInAs("BIBLIOTECARIO");

    const response = await registerAs(role);

    expect(response.status).toBe(201);
    expect(MemberSchema.parse(await response.json()).role).toBe(role);
  });
});
