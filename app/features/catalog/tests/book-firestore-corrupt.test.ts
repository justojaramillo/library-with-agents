import { ZodError } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { ApiErrorSchema } from "@/shared/schema";
import { DomainError } from "@/shared/server/errors";
import { handleError } from "@/shared/server/http";
import { createFirestoreBookRepository } from "../server/repository.firestore";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/shared/server/firebase", () => ({ getAdminAuth: () => ({}), getAdminDb: () => ({}) }));

/** S1 regla 16: un documento corrupto de `books` es un fallo del servidor (500), no un dato inválido (400). */
const VALID_FIELDS = { isbn: "9780000000001", title: "Rayuela", author: "Julio Cortázar", copies: 2 };
/** Ejemplares negativos y título sensible: el documento está corrupto. */
const CORRUPT_FIELDS = { ...VALID_FIELDS, title: "DATO-SENSIBLE", copies: -5 };

type Fields = Record<string, string | number>;
type Snapshot = { exists: boolean; id: string; data: () => Fields | undefined };

function snapshotOf(id: string, fields: Fields | undefined): Snapshot {
  return { exists: fields !== undefined, id, data: () => fields };
}

/**
 * Doble mínimo de Firestore: los documentos son un mapa id → campos; cualquier consulta devuelve todos los
 * documentos. Solo implementa lo que usa el repositorio de libros.
 */
function fakeDb(documents: Record<string, Fields>) {
  const all = Object.entries(documents).map(([id, fields]) => snapshotOf(id, fields));
  const query = {
    where: () => query,
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

type Repo = ReturnType<typeof repositoryOver>;

function repositoryOver(documents: Record<string, Fields>) {
  const db = fakeDb(documents);
  // @ts-expect-error el doble solo implementa la parte de Firestore que usa el repositorio de libros
  return createFirestoreBookRepository(db);
}

let logSpy: MockInstance<Console["error"]>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
});

describe("S1 regla 16 · documento corrupto de libros", () => {
  it("un documento válido se lee con su id", async () => {
    const found = await repositoryOver({ "b-1": VALID_FIELDS }).findById("b-1");

    expect(found).toEqual({ id: "b-1", ...VALID_FIELDS });
  });

  it.each([
    ["findById", (repo: Repo) => repo.findById("b-1")],
    ["findByIds", (repo: Repo) => repo.findByIds(["b-1"])],
    ["findByIsbn", (repo: Repo) => repo.findByIsbn(VALID_FIELDS.isbn)],
    ["search", (repo: Repo) => repo.search("", undefined)],
  ])("%s falla con un Error genérico, no con un ZodError ni un error de dominio", async (_name, read) => {
    const attempt = read(repositoryOver({ "b-1": CORRUPT_FIELDS }));

    await expect(attempt).rejects.toBeInstanceOf(Error);
    await expect(attempt).rejects.not.toBeInstanceOf(ZodError);
    await expect(attempt).rejects.not.toBeInstanceOf(DomainError);
  });

  it("la API lo traduce a 500 «Error interno» y no a 400", async () => {
    const error = await repositoryOver({ "b-1": CORRUPT_FIELDS })
      .search("", undefined)
      .catch((caught: Error) => caught);

    const response = handleError(error);

    expect(response.status).toBe(500);
    expect(ApiErrorSchema.parse(await response.json()).error).toBe("Error interno");
  });

  it("el cuerpo de la respuesta no filtra datos del documento", async () => {
    const error = await repositoryOver({ "b-1": CORRUPT_FIELDS })
      .findById("b-1")
      .catch((caught: Error) => caught);

    const text = await handleError(error).text();

    expect(text).not.toContain("DATO-SENSIBLE");
    expect(text).not.toContain("copies");
  });

  it("una búsqueda con un documento corrupto entre varios válidos también falla con 500", async () => {
    const error = await repositoryOver({ "b-1": VALID_FIELDS, "b-2": CORRUPT_FIELDS })
      .search("rayuela", undefined)
      .catch((caught: Error) => caught);

    expect(error).not.toBeInstanceOf(ZodError);
    expect(handleError(error).status).toBe(500);
  });

  it("falta un campo obligatorio: también 500", async () => {
    const error = await repositoryOver({ "b-1": { isbn: VALID_FIELDS.isbn, title: "X", copies: 1 } })
      .findById("b-1")
      .catch((caught: Error) => caught);

    expect(handleError(error).status).toBe(500);
  });
});
