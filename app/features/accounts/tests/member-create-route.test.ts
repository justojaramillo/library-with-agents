import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiErrorSchema, type Role } from "@/shared/schema";
import { resetRateLimits } from "@/shared/server/security/rate-limit";
import { emailOfLength, makeStaffWorld, PASSWORD, type StaffWorld } from "@/tests/helpers/staff";
import { MemberSchema } from "../schema";
import { POST as registerRoute } from "@/api/members/route";

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
    return { members: holder.world.members };
  },
}));

const JSON_HEADERS = { "content-type": "application/json", origin: "http://localhost" };

function currentWorld(): StaffWorld {
  if (holder.world === null) {
    throw new Error("sin mundo");
  }
  return holder.world;
}

async function signInAs(role: Role): Promise<void> {
  const person = await currentWorld().addPerson(role);
  holder.cookie = await currentWorld().sessionCookieFor(person);
}

function valid(over: { [key: string]: Json } = {}): { [key: string]: Json } {
  return { name: "Ana Gómez", email: "ana@example.com", password: PASSWORD, role: "EXTERNO", ...over };
}

function post(payload: Json, headers: Record<string, string> = JSON_HEADERS) {
  return registerRoute(
    new NextRequest("http://localhost/api/members", { method: "POST", headers, body: JSON.stringify(payload) }),
  );
}

/** Cuentas guardadas (sin contar a quien ingresó, que se crea antes de medir). */
async function accountCount(): Promise<number> {
  return (await currentWorld().repos.members.list(500)).members.length;
}

beforeEach(() => {
  resetRateLimits();
  holder.world = makeStaffWorld();
  holder.cookie = undefined;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-10T10:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("F36 · POST /api/members sigue como en F3 · caso feliz", () => {
  it.each([
    "BIBLIOTECARIO",
    "ADMINISTRADOR",
  ] satisfies Role[])("%s crea una cuenta EXTERNO: 201 y activa", async (actor) => {
    await signInAs(actor);

    const response = await post(valid());

    expect(response.status).toBe(201);
    expect(MemberSchema.strict().parse(await response.json())).toMatchObject({
      name: "Ana Gómez",
      email: "ana@example.com",
      role: "EXTERNO",
      active: true,
    });
  });

  it("crea una cuenta ESTUDIANTE", async () => {
    await signInAs("BIBLIOTECARIO");

    const response = await post(valid({ role: "ESTUDIANTE" }));

    expect(response.status).toBe(201);
    expect(MemberSchema.parse(await response.json()).role).toBe("ESTUDIANTE");
  });

  it("la persona puede ingresar con el correo y la contraseña entregados", async () => {
    await signInAs("BIBLIOTECARIO");
    await post(valid());

    expect(await currentWorld().identity.signIn("ana@example.com", PASSWORD)).not.toBeNull();
  });

  it("la respuesta no contiene la contraseña", async () => {
    await signInAs("BIBLIOTECARIO");

    const text = await (await post(valid())).text();

    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain("password");
  });

  it("sin rol en el cuerpo, la cuenta nace EXTERNO", async () => {
    await signInAs("BIBLIOTECARIO");

    const response = await post({ name: "Ana Gómez", email: "ana@example.com", password: PASSWORD });

    expect(response.status).toBe(201);
    expect(MemberSchema.parse(await response.json()).role).toBe("EXTERNO");
  });

  it("el correo con mayúsculas y espacios se guarda en minúsculas y sin espacios", async () => {
    await signInAs("BIBLIOTECARIO");

    const response = await post(valid({ email: "  ANA@Example.COM  " }));

    expect(response.status).toBe(201);
    expect(MemberSchema.parse(await response.json()).email).toBe("ana@example.com");
  });
});

describe("F36 · POST /api/members · rol no permitido (400)", () => {
  it.each([
    "DOCENTE",
    "BIBLIOTECARIO",
    "ADMINISTRADOR",
    "externo",
    "",
    "ROOT",
  ])("el rol «%s» da 400 y no se crea cuenta", async (role) => {
    await signInAs("ADMINISTRADOR");
    const before = await accountCount();

    const response = await post(valid({ role }));

    expect(response.status).toBe(400);
    expect(await accountCount()).toBe(before);
    expect(await currentWorld().identity.signIn("ana@example.com", PASSWORD)).toBeNull();
  });

  it("un rol que no es texto da 400", async () => {
    await signInAs("BIBLIOTECARIO");

    expect((await post(valid({ role: 1 }))).status).toBe(400);
    expect((await post(valid({ role: null }))).status).toBe(400);
  });
});

describe("F36 · POST /api/members · bordes de los campos", () => {
  beforeEach(async () => {
    await signInAs("BIBLIOTECARIO");
  });

  it.each([
    ["nombre vacío", { name: "" }, 400],
    ["nombre solo con espacios", { name: "     " }, 400],
    ["nombre de 1 carácter", { name: "A" }, 201],
    ["nombre de 120 caracteres", { name: "a".repeat(120) }, 201],
    ["nombre de 121 caracteres", { name: "a".repeat(121) }, 400],
    ["contraseña de 7 caracteres", { password: "a".repeat(7) }, 400],
    ["contraseña de 8 caracteres", { password: "a".repeat(8) }, 201],
    ["contraseña de 100 caracteres", { password: "a".repeat(100) }, 201],
    ["contraseña de 101 caracteres", { password: "a".repeat(101) }, 400],
    ["correo de 254 caracteres", { email: emailOfLength(254) }, 201],
    ["correo de 255 caracteres", { email: emailOfLength(255) }, 400],
    ["correo sin arroba", { email: "ana.example.com" }, 400],
    ["correo vacío", { email: "" }, 400],
  ])("%s → %s", async (_nombre, over, status) => {
    const response = await post(valid(over));

    expect(response.status).toBe(status);
    if (status === 400) {
      expect(ApiErrorSchema.safeParse(await response.json()).success).toBe(true);
    }
  });

  it("un cuerpo sin campos da 400", async () => {
    expect((await post({})).status).toBe(400);
  });
});

describe("F36 · POST /api/members · correo repetido (409)", () => {
  it("el mismo correo da 409 y no se crea otra cuenta", async () => {
    await signInAs("BIBLIOTECARIO");
    expect((await post(valid())).status).toBe(201);
    const before = await accountCount();

    const response = await post(valid({ name: "Otra Ana" }));

    expect(response.status).toBe(409);
    expect(await accountCount()).toBe(before);
  });

  it("también con otras mayúsculas y espacios alrededor", async () => {
    await signInAs("BIBLIOTECARIO");
    expect((await post(valid())).status).toBe(201);

    expect((await post(valid({ email: " ANA@EXAMPLE.COM " }))).status).toBe(409);
  });

  it("dos altas simultáneas con el mismo correo dejan como mucho una cuenta nueva", async () => {
    await signInAs("BIBLIOTECARIO");
    const before = await accountCount();

    const statuses = (await Promise.all([post(valid()), post(valid())])).map((response) => response.status);

    expect(statuses).toContain(201);
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(await accountCount()).toBe(before + 1);
  });
});

describe("F36 · POST /api/members · autorización", () => {
  it("sin sesión responde 401 y no crea cuenta", async () => {
    const response = await post(valid());

    expect(response.status).toBe(401);
    expect(await currentWorld().identity.signIn("ana@example.com", PASSWORD)).toBeNull();
  });

  it.each(["EXTERNO", "ESTUDIANTE", "DOCENTE"] satisfies Role[])("un %s recibe 403 y no crea cuenta", async (role) => {
    await signInAs(role);
    const before = await accountCount();

    const response = await post(valid());

    expect(response.status).toBe(403);
    expect(await accountCount()).toBe(before);
  });

  it("un cuerpo inválido de un prestatario responde 403: la autorización va primero", async () => {
    await signInAs("ESTUDIANTE");

    expect((await post({})).status).toBe(403);
  });

  it("una petición de otro origen responde 403 aunque sea personal", async () => {
    await signInAs("BIBLIOTECARIO");
    const before = await accountCount();

    const response = await post(valid(), {
      "content-type": "application/json",
      "sec-fetch-site": "cross-site",
      origin: "https://otro.example",
    });

    expect(response.status).toBe(403);
    expect(await accountCount()).toBe(before);
  });
});
