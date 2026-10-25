import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiErrorSchema, type Role } from "@/shared/schema";
import { makeWorld, type World } from "@/tests/helpers/factories";
import { MemberPageSchema, MemberSchema } from "../schema";
import type { MemberRecord } from "../server/repository";
import { resetRateLimits } from "@/shared/server/security/rate-limit";
import { GET as membersRoute } from "@/api/members/route";

type Session = { cookie: string | undefined; uid: string; role: Role; active: boolean };

const holder = vi.hoisted(() => ({
  world: null as World | null,
  session: { cookie: undefined, uid: "uid-1", role: "BIBLIOTECARIO", active: true } as Session,
}));

vi.mock("server-only", () => ({}));

// La sesión real se resuelve con la cookie y la cuenta; solo se sustituyen Next y Firebase.
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => {
      if (holder.session.cookie === undefined) {
        return undefined;
      }
      return { value: holder.session.cookie };
    },
  }),
}));

vi.mock("@/shared/server/firebase", () => ({
  getAdminAuth: () => ({ verifySessionCookie: async () => ({ uid: holder.session.uid }) }),
  getAdminDb: () => ({
    collection: () => ({
      doc: () => ({
        get: async () => ({
          exists: true,
          data: () => ({ role: holder.session.role, active: holder.session.active }),
        }),
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

function signInAs(role: Role) {
  holder.session = { cookie: "cookie-valida", uid: "uid-1", role, active: true };
}

function currentWorld(): World {
  if (holder.world === null) {
    throw new Error("sin mundo");
  }
  return holder.world;
}

let seq = 0;
async function addMember(name: string, over: Partial<MemberRecord> = {}): Promise<MemberRecord> {
  seq += 1;
  return currentWorld().repos.members.create({
    id: `r-${seq}`,
    name,
    email: `cuenta${seq}@example.com`,
    role: "ESTUDIANTE",
    active: true,
    ...over,
  });
}

function get(search: string) {
  return membersRoute(new NextRequest(`http://localhost/api/members${search}`));
}

beforeEach(() => {
  resetRateLimits();
  holder.world = makeWorld();
  holder.session = { cookie: undefined, uid: "uid-1", role: "BIBLIOTECARIO", active: true };
});

describe("GET /api/members?q= · autorización (B3)", () => {
  it("sin sesión responde 401", async () => {
    const response = await get("?q=ana");

    expect(response.status).toBe(401);
    expect(ApiErrorSchema.parse(await response.json()).error.length).toBeGreaterThan(0);
  });

  it.each([
    "EXTERNO",
    "ESTUDIANTE",
    "DOCENTE",
  ] satisfies Role[])("un %s no puede buscar personas: 403", async (role) => {
    await addMember("Ana Gómez");
    signInAs(role);

    const response = await get("?q=ana");

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("Ana");
  });

  it.each(["BIBLIOTECARIO", "ADMINISTRADOR"] satisfies Role[])("%s puede buscar: 200", async (role) => {
    await addMember("Ana Gómez");
    signInAs(role);

    const response = await get("?q=ana");

    expect(response.status).toBe(200);
  });

  it("una sesión de una cuenta inactiva se trata como sin sesión: 401", async () => {
    holder.session = { cookie: "cookie-valida", uid: "uid-1", role: "BIBLIOTECARIO", active: false };

    const response = await get("?q=ana");

    expect(response.status).toBe(401);
  });
});

describe("GET /api/members?q= · validación (400)", () => {
  beforeEach(() => {
    signInAs("BIBLIOTECARIO");
  });

  it("q de 1 carácter: 400", async () => {
    expect((await get("?q=a")).status).toBe(400);
  });

  it("q de solo símbolos: 400", async () => {
    expect((await get(`?q=${encodeURIComponent("!!!***")}`)).status).toBe(400);
  });

  it("q de 101 caracteres: 400", async () => {
    expect((await get(`?q=${"a".repeat(101)}`)).status).toBe(400);
  });

  it("q de 2 y de 100 caracteres se aceptan: 200", async () => {
    expect((await get("?q=an")).status).toBe(200);
    expect((await get(`?q=${"a".repeat(100)}`)).status).toBe(200);
  });

  it.each(["0", "21", "-1", "abc", "1.5"])("limit=%s: 400", async (limit) => {
    expect((await get(`?q=ana&limit=${limit}`)).status).toBe(400);
  });

  it("limit 1 y limit 20 se aceptan: 200", async () => {
    expect((await get("?q=ana&limit=1")).status).toBe(200);
    expect((await get("?q=ana&limit=20")).status).toBe(200);
  });

  it("lendable con un valor que no es true ni false: 400", async () => {
    expect((await get("?q=ana&lendable=si")).status).toBe(400);
  });

  it("el cuerpo del 400 es un error de la API", async () => {
    const response = await get("?q=a");

    expect(ApiErrorSchema.safeParse(await response.json()).success).toBe(true);
  });

  it("un q inválido de un prestatario responde 403 (la autorización va primero), no 400", async () => {
    signInAs("ESTUDIANTE");

    expect((await get("?q=a")).status).toBe(403);
  });
});

describe("GET /api/members?q= · resultados (200)", () => {
  beforeEach(() => {
    signInAs("BIBLIOTECARIO");
  });

  it("devuelve las cuentas que coinciden, ordenadas por nombre, con la forma pública", async () => {
    await addMember("Pedro Martínez");
    await addMember("María Pérez");
    await addMember("Luis Soto");

    const response = await get("?q=mar");

    expect(response.status).toBe(200);
    const list = MemberSchema.array().parse(await response.json());
    expect(list.map((member) => member.name)).toEqual(["María Pérez", "Pedro Martínez"]);
    expect(JSON.stringify(list)).not.toContain("search_keys");
  });

  it("«mar per» llega con el espacio codificado y encuentra a María Pérez", async () => {
    await addMember("María Pérez");
    await addMember("Pedro Martínez");

    const list = MemberSchema.array().parse(await (await get("?q=mar%20per")).json());

    expect(list.map((member) => member.name)).toEqual(["María Pérez"]);
  });

  it("sin coincidencias responde 200 con una lista vacía", async () => {
    await addMember("Luis Soto");

    const response = await get("?q=zzz");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("sin limit devuelve como máximo 10 (el valor por defecto)", async () => {
    for (let i = 0; i < 12; i += 1) {
      await addMember(`Lector ${String.fromCharCode(65 + i)}`);
    }

    const list = MemberSchema.array().parse(await (await get("?q=lector")).json());

    expect(list).toHaveLength(10);
  });

  it("limit=1 devuelve una sola cuenta: la primera por nombre", async () => {
    await addMember("Lector B");
    await addMember("Lector A");

    const list = MemberSchema.array().parse(await (await get("?q=lector&limit=1")).json());

    expect(list.map((member) => member.name)).toEqual(["Lector A"]);
  });

  it("lendable=true deja fuera las cuentas inactivas y las de personal, pero no a un DOCENTE", async () => {
    await addMember("Prueba Estudiante");
    await addMember("Prueba Docente", { role: "DOCENTE" });
    await addMember("Prueba Inactiva", { active: false });
    await addMember("Prueba Bibliotecario", { role: "BIBLIOTECARIO" });

    const list = MemberSchema.array().parse(await (await get("?q=prueba&lendable=true")).json());

    expect(list.map((member) => member.name)).toEqual(["Prueba Docente", "Prueba Estudiante"]);
  });

  it("sin lendable (o con false) salen todas las cuentas que coinciden", async () => {
    await addMember("Prueba Estudiante");
    await addMember("Prueba Inactiva", { active: false });
    await addMember("Prueba Bibliotecario", { role: "BIBLIOTECARIO" });

    expect(MemberSchema.array().parse(await (await get("?q=prueba")).json())).toHaveLength(3);
    expect(MemberSchema.array().parse(await (await get("?q=prueba&lendable=false")).json())).toHaveLength(3);
  });
});

describe("GET /api/members sin q (listado paginado, S1)", () => {
  it("sin sesión responde 401 y un prestatario 403", async () => {
    expect((await get("")).status).toBe(401);
    signInAs("ESTUDIANTE");
    expect((await get("")).status).toBe(403);
  });

  it("el personal recibe una MemberPage con todas las cuentas si caben en la página", async () => {
    await addMember("Ana Gómez");
    await addMember("Luis Soto", { active: false });
    await addMember("Marta Ríos", { role: "DOCENTE" });
    signInAs("BIBLIOTECARIO");

    const response = await get("");

    expect(response.status).toBe(200);
    const page = MemberPageSchema.parse(await response.json());
    expect(page.members).toHaveLength(3);
    expect(page.next_after).toBeNull();
  });

  it("un limit suelto sin q no lo convierte en búsqueda: lista una página de ese tamaño", async () => {
    await addMember("Ana Gómez");
    await addMember("Luis Soto");
    signInAs("ADMINISTRADOR");

    const response = await get("?limit=1");

    expect(response.status).toBe(200);
    const page = MemberPageSchema.parse(await response.json());
    expect(page.members.map((member) => member.name)).toEqual(["Ana Gómez"]);
    expect(page.next_after).toBe(page.members[0]?.id);
  });
});
