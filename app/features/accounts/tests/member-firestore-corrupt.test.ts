import { ZodError } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { ApiErrorSchema } from "@/shared/schema";
import { DomainError } from "@/shared/server/errors";
import { handleError } from "@/shared/server/http";
import { createFirestoreMemberRepository } from "../server/repository.firestore";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/shared/server/firebase", () => ({ getAdminAuth: () => ({}), getAdminDb: () => ({}) }));

/** S1 regla 16: un documento corrupto de `members` es un fallo del servidor (500), no un dato inválido (400). */
const VALID_FIELDS = { name: "Ana Pérez", email: "ana@example.com", role: "ESTUDIANTE", active: true };
/** Rol inventado y nombre sensible: el documento está corrupto. */
const CORRUPT_FIELDS = { ...VALID_FIELDS, name: "DATO-SENSIBLE", role: "SUPERUSUARIO" };

type Fields = Record<string, string | boolean | number>;
type Snapshot = { exists: boolean; id: string; data: () => Fields | undefined };

function snapshotOf(id: string, fields: Fields | undefined): Snapshot {
  return { exists: fields !== undefined, id, data: () => fields };
}

/**
 * Doble mínimo de Firestore: los documentos son un mapa id → campos; cualquier consulta (`where`, `orderBy`,
 * `startAfter`, `limit`) devuelve todos los documentos. Solo implementa lo que usa el repositorio de cuentas.
 */
function fakeDb(documents: Record<string, Fields>) {
  const all = Object.entries(documents).map(([id, fields]) => snapshotOf(id, fields));
  const query = {
    where: () => query,
    orderBy: () => query,
    startAfter: () => query,
    limit: () => query,
    get: async () => ({ docs: all, empty: all.length === 0 }),
  };
  const collection = {
    ...query,
    doc: (id: string) => ({ get: async () => snapshotOf(id, documents[id]) }),
  };
  return {
    collection: () => collection,
    getAll: async (...refs: { get: () => Promise<Snapshot> }[]) => Promise.all(refs.map((ref) => ref.get())),
  };
}

function repositoryOver(documents: Record<string, Fields>) {
  const db = fakeDb(documents);
  // @ts-expect-error el doble solo implementa la parte de Firestore que usa el repositorio de cuentas
  return createFirestoreMemberRepository(db);
}

let logSpy: MockInstance<Console["error"]>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
});

describe("S1 regla 16 · documento corrupto de cuentas: lecturas", () => {
  it("un documento válido se lee con su id", async () => {
    const found = await repositoryOver({ "m-1": VALID_FIELDS }).findById("m-1");

    expect(found).toEqual({ id: "m-1", ...VALID_FIELDS });
  });

  it.each([
    ["findById", (repo: ReturnType<typeof repositoryOver>) => repo.findById("m-1")],
    ["findByIds", (repo: ReturnType<typeof repositoryOver>) => repo.findByIds(["m-1"])],
    ["findByEmail", (repo: ReturnType<typeof repositoryOver>) => repo.findByEmail("ana@example.com")],
    ["list", (repo: ReturnType<typeof repositoryOver>) => repo.list(10)],
    ["search", (repo: ReturnType<typeof repositoryOver>) => repo.search("ana", 10, false)],
  ])("%s falla con un Error genérico, no con un ZodError ni un error de dominio", async (_name, read) => {
    const attempt = read(repositoryOver({ "m-1": CORRUPT_FIELDS }));

    await expect(attempt).rejects.toBeInstanceOf(Error);
    await expect(attempt).rejects.not.toBeInstanceOf(ZodError);
    await expect(attempt).rejects.not.toBeInstanceOf(DomainError);
  });

  it("la API lo traduce a 500 «Error interno» y no a 400", async () => {
    const error = await repositoryOver({ "m-1": CORRUPT_FIELDS })
      .findById("m-1")
      .catch((caught: Error) => caught);

    const response = handleError(error);

    expect(response.status).toBe(500);
    expect(ApiErrorSchema.parse(await response.json()).error).toBe("Error interno");
  });

  it("el cuerpo de la respuesta no filtra datos del documento", async () => {
    const error = await repositoryOver({ "m-1": CORRUPT_FIELDS })
      .findById("m-1")
      .catch((caught: Error) => caught);

    const text = await handleError(error).text();

    expect(text).not.toContain("DATO-SENSIBLE");
    expect(text).not.toContain("SUPERUSUARIO");
    expect(text).not.toContain("role");
  });

  it("falta un campo obligatorio: también 500", async () => {
    const error = await repositoryOver({ "m-1": { name: "Ana", role: "ESTUDIANTE", active: true } })
      .findById("m-1")
      .catch((caught: Error) => caught);

    expect(error).not.toBeInstanceOf(ZodError);
    expect(handleError(error).status).toBe(500);
  });

  it("un documento corrupto entre varios válidos hace fallar el listado completo con 500", async () => {
    const error = await repositoryOver({ "m-1": VALID_FIELDS, "m-2": CORRUPT_FIELDS })
      .list(10)
      .catch((caught: Error) => caught);

    expect(handleError(error).status).toBe(500);
  });
});

describe("S1 regla 16 · cursor de la paginación", () => {
  it("un cursor `after` que no existe sigue siendo un ZodError y la API responde 400", async () => {
    const error = await repositoryOver({ "m-1": VALID_FIELDS })
      .list(10, "no-existe")
      .catch((caught: Error) => caught);

    expect(error).toBeInstanceOf(ZodError);
    expect(handleError(error).status).toBe(400);
  });

  it("un cursor que existe pero está dañado es un error interno (500), no un cursor inexistente", async () => {
    const error = await repositoryOver({ "m-1": CORRUPT_FIELDS })
      .list(10, "m-1")
      .catch((caught: Error) => caught);

    expect(error).not.toBeInstanceOf(ZodError);
    expect(handleError(error).status).toBe(500);
  });

  it("un cursor válido pide la página sin error", async () => {
    const page = await repositoryOver({ "m-1": VALID_FIELDS, "m-2": { ...VALID_FIELDS, name: "Beto" } }).list(
      10,
      "m-1",
    );

    expect(page.members.length).toBeGreaterThan(0);
  });
});
