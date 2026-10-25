import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiErrorSchema, type Role } from "@/shared/schema";
import { resetRateLimits } from "@/shared/server/security/rate-limit";
import { makeWorld, type World } from "@/tests/helpers/factories";
import { MemberPageSchema, MemberSchema, type Member } from "../schema";
import type { MemberService } from "../server/member-service";
import type { MemberRecord } from "../server/repository";
import { GET as membersRoute } from "@/api/members/route";

type Session = { cookie: string | undefined; uid: string; role: Role; active: boolean };
type SearchDouble = Pick<MemberService, "search">;

const holder = vi.hoisted(() => ({
  world: null as World | null,
  searchDouble: null as SearchDouble | null,
  session: { cookie: undefined, uid: "uid-1", role: "BIBLIOTECARIO", active: true } as Session,
}));

vi.mock("server-only", () => ({}));

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
    if (holder.searchDouble !== null) {
      return { members: { ...holder.world.members, search: holder.searchDouble.search } };
    }
    return { members: holder.world.members };
  },
}));

const T0 = new Date("2026-01-10T10:00:00.000Z");

function signInAs(role: Role, uid = "uid-1") {
  holder.session = { cookie: "cookie-valida", uid, role, active: true };
}

function currentWorld(): World {
  if (holder.world === null) {
    throw new Error("sin mundo");
  }
  return holder.world;
}

async function addMember(id: string, name: string, over: Partial<MemberRecord> = {}): Promise<MemberRecord> {
  return currentWorld().repos.members.create({
    id,
    name,
    email: `${id}@example.com`,
    role: "ESTUDIANTE",
    active: true,
    ...over,
  });
}

async function addMany(count: number) {
  for (let i = 0; i < count; i += 1) {
    await addMember(`id-${String(i).padStart(3, "0")}`, `Nombre ${String(i % 40).padStart(2, "0")}`);
  }
}

function get(search: string) {
  return membersRoute(new NextRequest(`http://localhost/api/members${search}`));
}

beforeEach(() => {
  resetRateLimits();
  holder.world = makeWorld();
  holder.searchDouble = null;
  holder.session = { cookie: undefined, uid: "uid-1", role: "BIBLIOTECARIO", active: true };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/members sin q · autorización (S1 regla 6)", () => {
  it("sin sesión responde 401", async () => {
    const response = await get("");

    expect(response.status).toBe(401);
    expect(ApiErrorSchema.safeParse(await response.json()).success).toBe(true);
  });

  it.each(["EXTERNO", "ESTUDIANTE", "DOCENTE"] satisfies Role[])("un %s no puede listar cuentas: 403", async (role) => {
    await addMember("a", "Ana Gómez");
    signInAs(role);

    const response = await get("");

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("Ana");
  });

  it.each(["BIBLIOTECARIO", "ADMINISTRADOR"] satisfies Role[])("%s puede listar: 200", async (role) => {
    signInAs(role);

    expect((await get("")).status).toBe(200);
  });

  it("un limit inválido de un prestatario responde 403: la autorización va primero", async () => {
    signInAs("ESTUDIANTE");

    expect((await get("?limit=0")).status).toBe(403);
  });
});

describe("GET /api/members sin q · validación (400)", () => {
  beforeEach(() => {
    signInAs("BIBLIOTECARIO");
  });

  it.each(["0", "101", "-1", "abc", "2.5"])("limit=%s: 400", async (limit) => {
    const response = await get(`?limit=${limit}`);

    expect(response.status).toBe(400);
    expect(ApiErrorSchema.safeParse(await response.json()).success).toBe(true);
  });

  it("limit 1 y limit 100 se aceptan", async () => {
    await addMember("a", "Ana");

    expect((await get("?limit=1")).status).toBe(200);
    expect((await get("?limit=100")).status).toBe(200);
  });

  it("un after que no corresponde a ninguna cuenta: 400", async () => {
    await addMember("a", "Ana");

    const response = await get("?after=desconocido");

    expect(response.status).toBe(400);
    expect(ApiErrorSchema.safeParse(await response.json()).success).toBe(true);
  });
});

describe("GET /api/members sin q · páginas (200 MemberPage)", () => {
  beforeEach(() => {
    signInAs("BIBLIOTECARIO");
  });

  it("sin limit devuelve 50 de 120 cuentas y un next_after", async () => {
    await addMany(120);

    const page = MemberPageSchema.parse(await (await get("")).json());

    expect(page.members).toHaveLength(50);
    expect(page.next_after).toBe(page.members[49]?.id);
  });

  it("la respuesta es un objeto MemberPage exacto (members y next_after), no una lista", async () => {
    await addMember("a", "Ana");

    const response = await get("");

    expect(MemberPageSchema.strict().safeParse(await response.json()).success).toBe(true);
  });

  it("sin cuentas responde una página vacía con next_after null", async () => {
    expect(await (await get("")).json()).toEqual({ members: [], next_after: null });
  });

  it("seguir next_after recorre las 120 cuentas sin repetir ninguna y la última página no tiene cursor", async () => {
    await addMany(120);

    const sizes: number[] = [];
    const seen: string[] = [];
    let after = "";
    for (let guard = 0; guard < 10; guard += 1) {
      const page = MemberPageSchema.parse(await (await get(after)).json());
      sizes.push(page.members.length);
      seen.push(...page.members.map((item) => item.id));
      if (page.next_after === null) {
        break;
      }
      after = `?after=${page.next_after}`;
    }

    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(seen).size).toBe(120);
  });

  it("limit=100 con 120 cuentas devuelve 100 y la segunda página las 20 restantes", async () => {
    await addMany(120);

    const first = MemberPageSchema.parse(await (await get("?limit=100")).json());
    const second = MemberPageSchema.parse(await (await get(`?limit=100&after=${first.next_after}`)).json());

    expect(first.members).toHaveLength(100);
    expect(second.members).toHaveLength(20);
    expect(second.next_after).toBeNull();
  });

  it("devuelve la forma pública de cada cuenta, sin campos internos", async () => {
    await addMember("a", "Ana");

    const body = await (await get("")).text();

    expect(body).not.toContain("search_keys");
    expect(MemberSchema.safeParse(MemberPageSchema.parse(JSON.parse(body)).members[0]).success).toBe(true);
  });
});

describe("GET /api/members?q= · cabecera X-Search-Truncated (S1 regla 7)", () => {
  const found: Member[] = [{ id: "a", name: "Ana Gómez", email: "a@example.com", role: "ESTUDIANTE", active: true }];

  beforeEach(() => {
    signInAs("BIBLIOTECARIO");
  });

  it("si el servicio avisa de truncado, la respuesta lleva X-Search-Truncated: 1 y la misma lista de siempre", async () => {
    holder.searchDouble = { search: async () => ({ members: found, truncated: true }) };

    const response = await get("?q=ana");

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Search-Truncated")).toBe("1");
    expect(await response.json()).toEqual(found);
  });

  it("si no hay truncado, la cabecera no existe", async () => {
    holder.searchDouble = { search: async () => ({ members: found, truncated: false }) };

    const response = await get("?q=ana");

    expect(response.status).toBe(200);
    expect(response.headers.has("X-Search-Truncated")).toBe(false);
  });

  it("con el repositorio en memoria (que nunca trunca) tampoco aparece", async () => {
    await addMember("a", "Ana Gómez");

    expect((await get("?q=ana")).headers.has("X-Search-Truncated")).toBe(false);
  });

  it("el listado paginado no lleva la cabecera", async () => {
    expect((await get("")).headers.has("X-Search-Truncated")).toBe(false);
  });
});

describe("GET /api/members?q= · límite de tasa por miembro (S1 regla 4)", () => {
  beforeEach(() => {
    signInAs("BIBLIOTECARIO", "staff-1");
  });

  it("las primeras 30 búsquedas pasan y la 31 recibe 429 con Retry-After", async () => {
    for (let i = 0; i < 30; i += 1) {
      expect((await get("?q=ana")).status).toBe(200);
    }

    const response = await get("?q=ana");

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(ApiErrorSchema.safeParse(await response.json()).success).toBe(true);
  });

  it("otro miembro del personal no se ve afectado", async () => {
    for (let i = 0; i < 31; i += 1) {
      await get("?q=ana");
    }
    expect((await get("?q=ana")).status).toBe(429);

    signInAs("ADMINISTRADOR", "staff-2");

    expect((await get("?q=ana")).status).toBe(200);
  });

  it("pasado el minuto vuelve a responder 200", async () => {
    for (let i = 0; i < 31; i += 1) {
      await get("?q=ana");
    }
    expect((await get("?q=ana")).status).toBe(429);

    vi.setSystemTime(new Date(T0.getTime() + 60_000));

    expect((await get("?q=ana")).status).toBe(200);
  });

  it("el límite aplica antes que la validación: agotado el cupo, un q inválido responde 429 y no 400", async () => {
    for (let i = 0; i < 30; i += 1) {
      await get("?q=ana");
    }

    expect((await get("?q=a")).status).toBe(429);
  });

  it("las peticiones sin sesión o de un prestatario no gastan el cupo del personal", async () => {
    holder.session = { cookie: undefined, uid: "staff-1", role: "BIBLIOTECARIO", active: true };
    for (let i = 0; i < 40; i += 1) {
      expect((await get("?q=ana")).status).toBe(401);
    }
    signInAs("BIBLIOTECARIO", "staff-1");

    expect((await get("?q=ana")).status).toBe(200);
  });

  it("el listado sin q no se limita con el cupo de búsqueda", async () => {
    for (let i = 0; i < 35; i += 1) {
      expect((await get("")).status).toBe(200);
    }
  });
});
