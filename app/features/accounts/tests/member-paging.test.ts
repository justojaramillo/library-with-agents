import { ZodError } from "zod";
import { describe, expect, it } from "vitest";
import { createMemberService } from "../server/member-service";
import type { MemberRecord, MemberRepository } from "../server/repository";
import { ListMembersQuerySchema, MemberPageSchema, type MemberPage } from "../schema";
import { makeWorld } from "@/tests/helpers/factories";

function record(id: string, name: string, over: Partial<MemberRecord> = {}): MemberRecord {
  return { id, name, email: `${id}@example.com`, role: "ESTUDIANTE", active: true, ...over };
}

/** 120 cuentas con nombres repetidos (3 por nombre) creadas en un orden revuelto. */
function manyAccounts(count: number): MemberRecord[] {
  const all: MemberRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    all.push(record(`id-${String(i).padStart(3, "0")}`, `Nombre ${String(i % 40).padStart(2, "0")}`));
  }
  // Orden de creación distinto del orden de lectura: se recorre de 37 en 37 (37 es primo con 120).
  return all.map((_item, index) => all[(index * 37) % count]);
}

/** Orden esperado según la spec S1: por nombre y luego por id (códigos de carácter, nombres ASCII). */
function expectedOrder(records: MemberRecord[]): string[] {
  return [...records]
    .sort((a, b) => {
      if (a.name < b.name) {
        return -1;
      }
      if (a.name > b.name) {
        return 1;
      }
      if (a.id < b.id) {
        return -1;
      }
      if (a.id > b.id) {
        return 1;
      }
      return 0;
    })
    .map((item) => item.id);
}

async function worldWith(records: MemberRecord[]) {
  const world = makeWorld();
  for (const item of records) {
    await world.repos.members.create(item);
  }
  return world;
}

/** Recorre todas las páginas del servicio y devuelve cada una. */
async function walk(service: ReturnType<typeof makeWorld>["members"], limit: number): Promise<MemberPage[]> {
  const pages: MemberPage[] = [];
  let after: string | undefined;
  for (let guard = 0; guard < 1000; guard += 1) {
    const page = await service.list({ limit, after });
    pages.push(page);
    if (page.next_after === null) {
      return pages;
    }
    after = page.next_after;
  }
  throw new Error("la paginación no termina");
}

describe("S1 · esquema ListMembersQuerySchema", () => {
  const parse = (input: { limit?: string; after?: string }) => ListMembersQuerySchema.safeParse(input);

  it("sin parámetros el límite es 50 y no hay cursor", () => {
    expect(parse({})).toMatchObject({ success: true, data: { limit: 50 } });
  });

  it("limit 1 y 100 se aceptan; 0 y 101 se rechazan", () => {
    expect(parse({ limit: "1" }).success).toBe(true);
    expect(parse({ limit: "100" }).success).toBe(true);
    expect(parse({ limit: "0" }).success).toBe(false);
    expect(parse({ limit: "101" }).success).toBe(false);
  });

  it("limit no entero o no numérico se rechaza", () => {
    expect(parse({ limit: "2.5" }).success).toBe(false);
    expect(parse({ limit: "abc" }).success).toBe(false);
    expect(parse({ limit: "-1" }).success).toBe(false);
  });

  it("after se acepta como un id", () => {
    expect(parse({ after: "id-001" })).toMatchObject({ success: true, data: { after: "id-001" } });
  });
});

describe("S1 · MemberRepository.list (en memoria)", () => {
  it("ordena por nombre y, a igual nombre, por id", async () => {
    const world = await worldWith([record("c", "Ana"), record("a0", "Beto"), record("a", "Ana"), record("b", "Ana")]);

    const page = await world.repos.members.list(10);

    expect(page.members.map((item) => item.id)).toEqual(["a", "b", "c", "a0"]);
  });

  it("hasMore es true si queda al menos una cuenta y false si la página llegó al final", async () => {
    const world = await worldWith([record("a", "Ana"), record("b", "Beto"), record("c", "Carla")]);

    expect((await world.repos.members.list(2)).hasMore).toBe(true);
    expect((await world.repos.members.list(3)).hasMore).toBe(false);
    expect((await world.repos.members.list(4)).hasMore).toBe(false);
  });

  it("after devuelve las cuentas que siguen a esa, sin incluirla", async () => {
    const world = await worldWith([record("a", "Ana"), record("b", "Beto"), record("c", "Carla")]);

    const page = await world.repos.members.list(10, "a");

    expect(page.members.map((item) => item.id)).toEqual(["b", "c"]);
  });

  it("un after inexistente lanza ZodError (400)", async () => {
    const world = await worldWith([record("a", "Ana")]);

    await expect(world.repos.members.list(10, "no-existe")).rejects.toBeInstanceOf(ZodError);
  });

  it("sin cuentas devuelve una página vacía", async () => {
    const world = makeWorld();

    await expect(world.repos.members.list(10)).resolves.toEqual({ members: [], hasMore: false });
  });
});

describe("S1 · MemberRepository.search (en memoria) · truncated", () => {
  it("en memoria nunca se alcanza el tope de lectura: truncated es false", async () => {
    const world = await worldWith([record("a", "Prueba Uno"), record("b", "Prueba Dos")]);

    const found = await world.repos.members.search("prueba", 10, false);

    expect(found.truncated).toBe(false);
  });
});

describe("S1 · MemberService.list · orden y tamaño de página", () => {
  it("ordena por nombre y luego por id aunque se hayan creado en otro orden", async () => {
    const world = await worldWith([record("z", "Ana"), record("m", "Ana"), record("a", "Ana"), record("k", "Beto")]);

    const page = await world.members.list({ limit: 50 });

    expect(page.members.map((item) => item.id)).toEqual(["a", "m", "z", "k"]);
  });

  it("limit 1 devuelve una sola cuenta y su id como next_after", async () => {
    const world = await worldWith([record("a", "Ana"), record("b", "Beto")]);

    const page = await world.members.list({ limit: 1 });

    expect(page.members.map((item) => item.id)).toEqual(["a"]);
    expect(page.next_after).toBe("a");
  });

  it("limit 1 con una sola cuenta: next_after es null", async () => {
    const world = await worldWith([record("a", "Ana")]);

    const page = await world.members.list({ limit: 1 });

    expect(page.members).toHaveLength(1);
    expect(page.next_after).toBeNull();
  });

  it("limit 50 con 120 cuentas devuelve 50 y next_after es el id de la última de la página", async () => {
    const records = manyAccounts(120);
    const world = await worldWith(records);

    const page = await world.members.list({ limit: 50 });

    const order = expectedOrder(records);
    expect(page.members.map((item) => item.id)).toEqual(order.slice(0, 50));
    expect(page.next_after).toBe(order[49]);
  });

  it("limit 100 con 120 cuentas devuelve 100 y next_after es el id de la número 100", async () => {
    const records = manyAccounts(120);
    const world = await worldWith(records);

    const page = await world.members.list({ limit: 100 });

    expect(page.members).toHaveLength(100);
    expect(page.next_after).toBe(expectedOrder(records)[99]);
  });

  it("sin cuentas: página vacía y next_after null", async () => {
    const world = makeWorld();

    await expect(world.members.list({ limit: 50 })).resolves.toEqual({ members: [], next_after: null });
  });

  it("next_after es siempre el id de la última cuenta de la página", async () => {
    const world = await worldWith(manyAccounts(10));

    const page = await world.members.list({ limit: 4 });

    expect(page.next_after).toBe(page.members.at(-1)?.id);
  });

  it("la página cumple el contrato MemberPage y solo expone campos públicos", async () => {
    const world = await worldWith([record("a", "Ana")]);

    const page = await world.members.list({ limit: 50 });

    expect(MemberPageSchema.safeParse(page).success).toBe(true);
    expect(Object.keys(page.members[0] ?? {}).sort()).toEqual(["active", "email", "id", "name", "role"]);
    expect(JSON.stringify(page)).not.toContain("search_keys");
  });
});

describe("S1 · MemberService.list · recorrido con cursor", () => {
  it("recorre 120 cuentas en páginas de 50 sin repetir ni omitir ninguna, en el orden esperado", async () => {
    const records = manyAccounts(120);
    const world = await worldWith(records);

    const pages = await walk(world.members, 50);

    expect(pages.map((page) => page.members.length)).toEqual([50, 50, 20]);
    const ids = pages.flatMap((page) => page.members.map((item) => item.id));
    expect(new Set(ids).size).toBe(120);
    expect(ids).toEqual(expectedOrder(records));
  });

  it("solo la última página tiene next_after null", async () => {
    const world = await worldWith(manyAccounts(120));

    const pages = await walk(world.members, 50);

    expect(pages.map((page) => page.next_after === null)).toEqual([false, false, true]);
  });

  it("última página exacta: 100 cuentas en páginas de 50 terminan en la segunda, sin cursor sobrante", async () => {
    const world = await worldWith(manyAccounts(100));

    const pages = await walk(world.members, 50);

    expect(pages).toHaveLength(2);
    expect(pages[1]?.members).toHaveLength(50);
    expect(pages[1]?.next_after).toBeNull();
  });

  it("101 cuentas con limit 100: la segunda página tiene una cuenta", async () => {
    const world = await worldWith(manyAccounts(101));

    const pages = await walk(world.members, 100);

    expect(pages.map((page) => page.members.length)).toEqual([100, 1]);
  });

  it("con limit 1 el recorrido de 5 cuentas da 5 páginas sin repetir", async () => {
    const world = await worldWith(manyAccounts(5));

    const pages = await walk(world.members, 1);

    expect(pages).toHaveLength(5);
    expect(new Set(pages.flatMap((page) => page.members.map((item) => item.id))).size).toBe(5);
  });

  it("cuentas con el mismo nombre se reparten entre páginas sin perder ninguna", async () => {
    const records = ["e", "d", "c", "b", "a"].map((id) => record(id, "Ana Gómez"));
    const world = await worldWith(records);

    const pages = await walk(world.members, 2);

    expect(pages.flatMap((page) => page.members.map((item) => item.id))).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("usar como after la última cuenta devuelve una página vacía sin más cursor", async () => {
    const world = await worldWith([record("a", "Ana"), record("b", "Beto")]);

    await expect(world.members.list({ limit: 50, after: "b" })).resolves.toEqual({ members: [], next_after: null });
  });

  it("un after inexistente es un error de validación (ZodError, 400)", async () => {
    const world = await worldWith([record("a", "Ana")]);

    await expect(world.members.list({ limit: 50, after: "no-existe" })).rejects.toBeInstanceOf(ZodError);
  });
});

/** Repositorio que delega en el de memoria pero cuya búsqueda avisa de que se alcanzó el tope. */
function truncatingRepository(inner: MemberRepository): MemberRepository {
  return {
    create: (item) => inner.create(item),
    findById: (id) => inner.findById(id),
    findByIds: (ids) => inner.findByIds(ids),
    findByEmail: (email) => inner.findByEmail(email),
    existsWithRole: (role) => inner.existsWithRole(role),
    list: (limit, after) => inner.list(limit, after),
    setActive: (id, active) => inner.setActive(id, active),
    listByRoles: (roles, limit) => inner.listByRoles(roles, limit),
    search: async (q, limit, lendable) => {
      const found = await inner.search(q, limit, lendable);
      return { members: found.members, truncated: true };
    },
  };
}

describe("S1 · MemberService.search · truncated (regla 7)", () => {
  it("transmite truncated: true cuando el repositorio alcanzó el tope", async () => {
    const world = await worldWith([record("a", "Prueba Uno")]);
    const service = createMemberService({
      members: truncatingRepository(world.repos.members),
      identity: world.identity,
    });

    const found = await service.search({ q: "prueba", limit: 10, lendable: false });

    expect(found.truncated).toBe(true);
    expect(found.members.map((item) => item.id)).toEqual(["a"]);
  });

  it("truncated es false cuando el repositorio no alcanzó el tope", async () => {
    const world = await worldWith([record("a", "Prueba Uno")]);

    const found = await world.members.search({ q: "prueba", limit: 10, lendable: false });

    expect(found.truncated).toBe(false);
  });
});
