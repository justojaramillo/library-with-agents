import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemberSchema } from "../schema";
import { createMemberService } from "../server/member-service";
import type { MemberRecord, MemberRepository } from "../server/repository";
import { ApiErrorSchema } from "@/shared/schema";
import { resetRateLimits } from "@/shared/server/security/rate-limit";
import { makeWorld, type World } from "@/tests/helpers/factories";
import { POST as registerRoute } from "@/api/auth/register/route";

type Service = ReturnType<typeof createMemberService>;
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const holder = vi.hoisted(() => ({
  world: null as World | null,
  service: null as Service | null,
}));

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

// El registro es público: si la ruta intentara leer la sesión o Firestore, estas funciones fallarían.
vi.mock("@/shared/server/firebase", () => ({
  getAdminAuth: () => {
    throw new Error("la ruta pública no debe usar Firebase Admin");
  },
  getAdminDb: () => {
    throw new Error("la ruta pública no debe usar Firestore");
  },
}));

vi.mock("@/features/container", () => ({
  getContainer: () => {
    if (holder.world === null) {
      throw new Error("la prueba no preparó el mundo");
    }
    return { members: holder.service ?? holder.world.members };
  },
}));

const T0 = new Date("2026-01-10T10:00:00.000Z");
const PASSWORD = "clave-segura-123";
/** Lo que envía un navegador del mismo origen: el servidor exige Origin o Sec-Fetch-Site en los POST. */
const JSON_HEADERS = { "content-type": "application/json", origin: "http://localhost" };

function currentWorld(): World {
  if (holder.world === null) {
    throw new Error("sin mundo");
  }
  return holder.world;
}

/** Petición POST de un navegador del mismo origen; `ip` va en `x-forwarded-for`. */
function request(rawBody: string, headers: Record<string, string> = {}, ip?: string): NextRequest {
  const all: Record<string, string> = { ...JSON_HEADERS, ...headers };
  if (ip !== undefined) {
    all["x-forwarded-for"] = ip;
  }
  return new NextRequest("http://localhost/api/auth/register", { method: "POST", headers: all, body: rawBody });
}

function post(payload: Json, ip?: string) {
  return registerRoute(request(JSON.stringify(payload), {}, ip));
}

function valid(over: { [key: string]: Json } = {}): { [key: string]: Json } {
  return { name: "Ana Gómez", email: "ana@example.com", password: PASSWORD, ...over };
}

async function accountCount(): Promise<number> {
  return (await currentWorld().members.list({ limit: 100 })).members.length;
}

async function identityExists(email: string, password = PASSWORD): Promise<boolean> {
  return (await currentWorld().identity.signIn(email, password)) !== null;
}

beforeEach(() => {
  resetRateLimits();
  holder.world = makeWorld();
  holder.service = null;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("F10 · POST /api/auth/register · caso feliz", () => {
  it("un visitante sin rol queda como EXTERNO y activo (201)", async () => {
    const response = await post(valid());

    expect(response.status).toBe(201);
    const member = MemberSchema.parse(await response.json());
    expect(member).toMatchObject({ name: "Ana Gómez", email: "ana@example.com", role: "EXTERNO", active: true });
  });

  it("con role ESTUDIANTE la cuenta queda ESTUDIANTE", async () => {
    const response = await post(valid({ role: "ESTUDIANTE" }));

    expect(response.status).toBe(201);
    expect(MemberSchema.parse(await response.json()).role).toBe("ESTUDIANTE");
  });

  it("con role EXTERNO explícito la cuenta queda EXTERNO", async () => {
    const response = await post(valid({ role: "EXTERNO" }));

    expect(response.status).toBe(201);
    expect(MemberSchema.parse(await response.json()).role).toBe("EXTERNO");
  });

  it("guarda el correo recortado y en minúsculas", async () => {
    const response = await post(valid({ email: "  ANA@Example.COM  " }));

    expect(response.status).toBe(201);
    expect(MemberSchema.parse(await response.json()).email).toBe("ana@example.com");
  });

  it("la cuenta creada existe en el repositorio y su identidad permite ingresar con esa contraseña", async () => {
    const member = MemberSchema.parse(await (await post(valid())).json());

    expect((await currentWorld().repos.members.findById(member.id))?.email).toBe("ana@example.com");
    expect(await identityExists("ana@example.com")).toBe(true);
  });

  it("la respuesta no contiene la contraseña ni search_keys ni campo de contraseña", async () => {
    const text = await (await post(valid())).text();

    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain("search_keys");
    expect(text).not.toContain("password");
    expect(MemberSchema.strict().safeParse(JSON.parse(text)).success).toBe(true);
  });

  it("no crea sesión: la respuesta no fija ninguna cookie", async () => {
    const response = await post(valid());

    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("si el visitante ya trae una cookie de sesión, la ruta funciona igual y no la cambia", async () => {
    const response = await registerRoute(request(JSON.stringify(valid()), { cookie: "session=cualquiera" }));

    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("F10 · rol: solo EXTERNO o ESTUDIANTE (regla 1)", () => {
  it.each([
    ["DOCENTE", "DOCENTE"],
    ["BIBLIOTECARIO", "BIBLIOTECARIO"],
    ["ADMINISTRADOR", "ADMINISTRADOR"],
    ["en minúsculas", "estudiante"],
    ["con otra capitalización", "Estudiante"],
    ["vacío", ""],
    ["null", null],
    ["un rol inventado", "SUPERUSUARIO"],
    ["un número", 1],
    ["un arreglo", ["ESTUDIANTE"]],
  ] satisfies [string, Json][])("role %s: 400 y no se crea ni la cuenta ni la identidad", async (_name, role) => {
    const response = await post(valid({ email: "colado@example.com", role }));

    expect(response.status).toBe(400);
    expect(ApiErrorSchema.safeParse(await response.json()).success).toBe(true);
    expect(await accountCount()).toBe(0);
    expect(await identityExists("colado@example.com")).toBe(false);
  });

  it("un rol prohibido no crea cuenta aunque el cuerpo traiga otros campos de personal", async () => {
    const response = await post(valid({ role: "ADMINISTRADOR", active: true, member_id: "uid-admin" }));

    expect(response.status).toBe(400);
    expect(await accountCount()).toBe(0);
  });
});

describe("F10 · campos extra se ignoran (criterio de aceptación)", () => {
  it("active:false en el cuerpo no deja la cuenta inactiva", async () => {
    const response = await post(valid({ active: false }));

    expect(response.status).toBe(201);
    expect(MemberSchema.parse(await response.json()).active).toBe(true);
  });

  it("member_id e id en el cuerpo no cambian el id de la cuenta", async () => {
    const response = await post(valid({ member_id: "uid-elegido", id: "otro-id" }));

    expect(response.status).toBe(201);
    const member = MemberSchema.parse(await response.json());
    expect(member.id).not.toBe("uid-elegido");
    expect(member.id).not.toBe("otro-id");
    expect(await currentWorld().repos.members.findById("uid-elegido")).toBeUndefined();
  });

  it("otros campos desconocidos (is_admin, search_keys) no cambian el resultado", async () => {
    const response = await post(valid({ is_admin: true, search_keys: ["x"] }));

    expect(response.status).toBe(201);
    const member = MemberSchema.parse(await response.json());
    expect(member.role).toBe("EXTERNO");
  });
});

describe("F10 · correo repetido (regla 2)", () => {
  it("un correo ya registrado: 409 con el mensaje de la spec y sin segunda cuenta", async () => {
    await post(valid());

    const response = await post(valid({ name: "Otra Persona" }));

    expect(response.status).toBe(409);
    expect(ApiErrorSchema.parse(await response.json()).error).toBe("Ya existe una cuenta con ese correo.");
    expect(await accountCount()).toBe(1);
  });

  it.each([
    "ANA@EXAMPLE.COM",
    "  ana@example.com  ",
    " Ana@Example.Com ",
  ])("el mismo correo escrito como «%s»: 409", async (email) => {
    await post(valid());

    const response = await post(valid({ email }));

    expect(response.status).toBe(409);
    expect(await accountCount()).toBe(1);
  });

  it("un correo de una cuenta creada por el personal (provision) también da 409", async () => {
    await currentWorld().members.provision({
      name: "Personal",
      email: "personal@example.com",
      password: PASSWORD,
      role: "BIBLIOTECARIO",
    });

    expect((await post(valid({ email: "PERSONAL@example.com" }))).status).toBe(409);
  });

  it("dos registros simultáneos con el mismo correo: uno 201 y otro 409, una sola cuenta", async () => {
    const responses = await Promise.all([post(valid()), post(valid({ name: "Gemela" }))]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await accountCount()).toBe(1);
  });

  it("dos registros simultáneos con el mismo correo en distinto formato: uno 201 y otro 409", async () => {
    const responses = await Promise.all([post(valid()), post(valid({ email: "  ANA@example.com " }))]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await accountCount()).toBe(1);
  });
});

describe("F10 · contraseña de 8 a 100 caracteres (bordes)", () => {
  it.each([
    [7, 400],
    [8, 201],
    [100, 201],
    [101, 400],
  ])("contraseña de %i caracteres: %i", async (length, status) => {
    const response = await post(valid({ password: "p".repeat(length) }));

    expect(response.status).toBe(status);
    if (status === 400) {
      expect(await accountCount()).toBe(0);
      expect(await identityExists("ana@example.com", "p".repeat(length))).toBe(false);
    }
  });

  it("sin contraseña: 400", async () => {
    expect((await post({ name: "Ana", email: "ana@example.com" })).status).toBe(400);
  });
});

describe("F10 · nombre y correo (bordes)", () => {
  it.each([
    [1, 201],
    [120, 201],
    [121, 400],
  ])("nombre de %i caracteres: %i", async (length, status) => {
    expect((await post(valid({ name: "n".repeat(length) }))).status).toBe(status);
  });

  it("nombre solo con espacios: 400", async () => {
    const response = await post(valid({ name: "     " }));

    expect(response.status).toBe(400);
    expect(await accountCount()).toBe(0);
  });

  it("nombre vacío o ausente: 400", async () => {
    expect((await post(valid({ name: "" }))).status).toBe(400);
    expect((await post({ email: "ana@example.com", password: PASSWORD })).status).toBe(400);
  });

  it("el nombre se guarda recortado", async () => {
    const member = MemberSchema.parse(await (await post(valid({ name: "  Ana Gómez  " }))).json());

    expect(member.name).toBe("Ana Gómez");
  });

  it.each(["no-es-correo", "ana@", "@example.com", "ana@example", ""])("correo «%s»: 400", async (email) => {
    const response = await post(valid({ email }));

    expect(response.status).toBe(400);
    expect(await accountCount()).toBe(0);
  });

  it("sin correo: 400", async () => {
    expect((await post({ name: "Ana", password: PASSWORD })).status).toBe(400);
  });
});

describe("F10 · cuerpo mal formado", () => {
  it("cuerpo vacío: 400", async () => {
    const response = await registerRoute(request(""));

    expect(response.status).toBe(400);
    expect(ApiErrorSchema.safeParse(await response.json()).success).toBe(true);
  });

  it("cuerpo que no es JSON: 400", async () => {
    const response = await registerRoute(request("esto no es json"));

    expect(response.status).toBe(400);
    expect(await accountCount()).toBe(0);
  });

  it.each(["{}", "[]", "null", '"texto"', "42"])("el JSON «%s» no es una cuenta: 400", async (raw) => {
    expect((await registerRoute(request(raw))).status).toBe(400);
  });
});

describe("F10 · protección de origen (regla 4)", () => {
  it("una petición de otro origen (Origin distinto): 403 y no se crea nada", async () => {
    const response = await registerRoute(request(JSON.stringify(valid()), { origin: "https://evil.example" }));

    expect(response.status).toBe(403);
    expect(await accountCount()).toBe(0);
    expect(await identityExists("ana@example.com")).toBe(false);
  });

  it("Sec-Fetch-Site cross-site: 403", async () => {
    const response = await registerRoute(request(JSON.stringify(valid()), { "sec-fetch-site": "cross-site" }));

    expect(response.status).toBe(403);
  });

  it("un cuerpo que no declara application/json (formulario entre sitios): 403", async () => {
    const response = await registerRoute(
      request("name=Ana&email=ana@example.com&password=clave-segura-123", {
        "content-type": "application/x-www-form-urlencoded",
      }),
    );

    expect(response.status).toBe(403);
    expect(await accountCount()).toBe(0);
  });

  it("el mismo origen declarado (Origin igual al del servidor): 201", async () => {
    const response = await registerRoute(request(JSON.stringify(valid()), { origin: "http://localhost" }));

    expect(response.status).toBe(201);
  });

  it("el origen se comprueba antes que el límite: las peticiones ajenas no gastan el cupo de la IP", async () => {
    const ip = "203.0.113.50";
    for (let i = 0; i < 15; i += 1) {
      const blocked = await registerRoute(
        request(JSON.stringify(valid({ email: `x${i}@example.com` })), { origin: "https://evil.example" }, ip),
      );
      expect(blocked.status).toBe(403);
    }

    expect((await post(valid(), ip)).status).toBe(201);
  });
});

describe("F10 / F17 · límite de tasa por IP (10 por hora)", () => {
  const IP = "203.0.113.7";

  async function registerMany(count: number, ip: string | undefined, prefix = "u") {
    const statuses: number[] = [];
    for (let i = 0; i < count; i += 1) {
      statuses.push((await post(valid({ email: `${prefix}${i}@example.com` }), ip)).status);
    }
    return statuses;
  }

  it("los 10 primeros registros de una IP pasan y el 11.º recibe 429 con Retry-After", async () => {
    const statuses = await registerMany(10, IP);
    expect(statuses).toEqual(Array<number>(10).fill(201));

    const response = await post(valid({ email: "once@example.com" }), IP);

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(Number(response.headers.get("Retry-After"))).toBeLessThanOrEqual(3600);
    expect(ApiErrorSchema.safeParse(await response.json()).success).toBe(true);
    expect(await accountCount()).toBe(10);
    expect(await identityExists("once@example.com")).toBe(false);
  });

  it("el Retry-After del primer rechazo es de una hora cuando todo ocurre en el mismo instante", async () => {
    await registerMany(10, IP);

    const response = await post(valid({ email: "once@example.com" }), IP);

    expect(response.headers.get("Retry-After")).toBe("3600");
  });

  it("otra IP no se ve afectada por una IP agotada", async () => {
    await registerMany(10, IP);
    expect((await post(valid({ email: "once@example.com" }), IP)).status).toBe(429);

    expect((await post(valid({ email: "otra@example.com" }), "198.51.100.9")).status).toBe(201);
  });

  it("sin IP válida no se limita: 15 registros sin cabecera pasan", async () => {
    const statuses = await registerMany(15, undefined);

    expect(statuses).toEqual(Array<number>(15).fill(201));
  });

  it("con una IP inválida en la cabecera tampoco se limita", async () => {
    const statuses = await registerMany(15, "no-soy-una-ip");

    expect(statuses).toEqual(Array<number>(15).fill(201));
  });

  it("el límite va antes que la validación: agotado el cupo, un cuerpo inválido responde 429 y no 400", async () => {
    await registerMany(10, IP);

    expect((await post({ nombre: "mal" }, IP)).status).toBe(429);
  });

  it("los intentos inválidos también gastan el cupo (el límite va antes de validar)", async () => {
    for (let i = 0; i < 10; i += 1) {
      expect((await post({ nombre: "mal" }, IP)).status).toBe(400);
    }

    expect((await post(valid(), IP)).status).toBe(429);
  });

  it("un correo repetido (409) también gasta el cupo", async () => {
    await post(valid(), IP);
    for (let i = 0; i < 9; i += 1) {
      expect((await post(valid(), IP)).status).toBe(409);
    }

    expect((await post(valid({ email: "nuevo@example.com" }), IP)).status).toBe(429);
  });

  it("pasada la hora vuelve a aceptar registros; un milisegundo antes todavía rechaza", async () => {
    await registerMany(10, IP);

    vi.setSystemTime(new Date(T0.getTime() + 3_600_000 - 1));
    expect((await post(valid({ email: "casi@example.com" }), IP)).status).toBe(429);

    vi.setSystemTime(new Date(T0.getTime() + 3_600_000));
    expect((await post(valid({ email: "ya@example.com" }), IP)).status).toBe(201);
  });

  it("a los 61 segundos el cupo sigue agotado (la ventana de registro es de una hora, no de un minuto)", async () => {
    await registerMany(10, IP);

    vi.setSystemTime(new Date(T0.getTime() + 61_000));

    expect((await post(valid({ email: "tarde@example.com" }), IP)).status).toBe(429);
  });
});

/** Repositorio que delega en otro pero cuyo `create` siempre falla (simula una caída de Firestore). */
function failingCreate(inner: MemberRepository): MemberRepository {
  return {
    create: async (record: MemberRecord) => {
      throw new Error(`Firestore caído al guardar ${record.email}`);
    },
    findById: (id) => inner.findById(id),
    findByIds: (ids) => inner.findByIds(ids),
    findByEmail: (email) => inner.findByEmail(email),
    existsWithRole: (role) => inner.existsWithRole(role),
    list: (limit, after) => inner.list(limit, after),
    search: (q, limit, lendable) => inner.search(q, limit, lendable),
    setActive: (id, active) => inner.setActive(id, active),
    listByRoles: (roles, limit) => inner.listByRoles(roles, limit),
  };
}

describe("F10 · atomicidad: si guardar el documento falla (regla 5)", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("responde 500 sin filtrar el detalle, la identidad se borra y no queda cuenta", async () => {
    const world = currentWorld();
    holder.service = createMemberService({ members: failingCreate(world.repos.members), identity: world.identity });

    const response = await post(valid({ email: "caida@example.com" }));

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("Firestore");
    expect(await identityExists("caida@example.com")).toBe(false);
    expect(await accountCount()).toBe(0);
  });

  it("tras el fallo el mismo correo puede volver a registrarse (201)", async () => {
    const world = currentWorld();
    holder.service = createMemberService({ members: failingCreate(world.repos.members), identity: world.identity });
    expect((await post(valid({ email: "reintento@example.com" }))).status).toBe(500);

    holder.service = null;
    const retry = await post(valid({ email: "reintento@example.com" }));

    expect(retry.status).toBe(201);
    expect(await identityExists("reintento@example.com")).toBe(true);
    expect(await accountCount()).toBe(1);
  });

  it("si además falla el borrado de la identidad: sigue siendo 500 y la identidad huérfana queda (para el reconciliador)", async () => {
    const world = currentWorld();
    const identity = {
      createUser: (input: Parameters<World["identity"]["createUser"]>[0]) => world.identity.createUser(input),
      deleteUser: async () => {
        throw new Error("Authentication caído al borrar");
      },
      verifyIdToken: (token: string) => world.identity.verifyIdToken(token),
      createSessionCookie: (token: string, ttl: number) => world.identity.createSessionCookie(token, ttl),
      isEmailVerified: async () => false,
    };
    holder.service = createMemberService({ members: failingCreate(world.repos.members), identity });

    const response = await post(valid({ email: "huerfana@example.com" }));

    expect(response.status).toBe(500);
    expect(await identityExists("huerfana@example.com")).toBe(true);
    expect(await accountCount()).toBe(0);
  });
});
