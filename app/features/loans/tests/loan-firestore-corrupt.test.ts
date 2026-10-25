import { ZodError } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { ApiErrorSchema } from "@/shared/schema";
import { DomainError } from "@/shared/server/errors";
import { handleError } from "@/shared/server/http";
import { createFirestoreLoanRepository } from "../server/repository.firestore";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/shared/server/firebase", () => ({ getAdminAuth: () => ({}), getAdminDb: () => ({}) }));

/** Documento de préstamo tal como lo guarda Firestore. */
const VALID_FIELDS = {
  book_id: "b-1",
  member_id: "m-1",
  loaned_at: "2026-01-09T10:00:00.000Z",
  due_at: "2026-01-14T10:00:00.000Z",
  returned_at: null,
};
/** Un campo con el tipo equivocado: el documento está corrupto. */
const CORRUPT_FIELDS = { ...VALID_FIELDS, due_at: 12345, member_id: "DATO-SENSIBLE" };

/**
 * Doble mínimo de Firestore: un único documento `l-1` (y la colección con ese documento). Solo implementa lo que usan
 * `findById` y `listAll`; no hay emulador en el entorno.
 */
function fakeDb(fields: object) {
  const snapshot = { exists: true, id: "l-1", data: () => fields };
  return {
    collection: () => ({
      doc: () => ({ get: async () => snapshot }),
      get: async () => ({ docs: [snapshot] }),
    }),
  };
}

function repositoryOver(fields: object) {
  const db = fakeDb(fields);
  // @ts-expect-error el doble solo implementa la parte de Firestore que usan estas pruebas
  return createFirestoreLoanRepository(db);
}

let logSpy: MockInstance<Console["error"]>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
});

describe("S1 regla 9 · documento de préstamo corrupto en Firestore", () => {
  it("un documento válido se lee con su id", async () => {
    const loan = await repositoryOver(VALID_FIELDS).findById("l-1");

    expect(loan).toEqual({ ...VALID_FIELDS, id: "l-1" });
  });

  it("un documento inválido hace fallar la consulta con un Error genérico, no con un ZodError", async () => {
    const attempt = repositoryOver(CORRUPT_FIELDS).findById("l-1");

    await expect(attempt).rejects.toBeInstanceOf(Error);
    await expect(attempt).rejects.not.toBeInstanceOf(ZodError);
    await expect(attempt).rejects.not.toBeInstanceOf(DomainError);
  });

  it("la API lo traduce a 500 «Error interno» y no a 400", async () => {
    const error = await repositoryOver(CORRUPT_FIELDS)
      .findById("l-1")
      .catch((caught: Error) => caught);

    const response = handleError(error);

    expect(response.status).toBe(500);
    expect(ApiErrorSchema.parse(await response.json()).error).toBe("Error interno");
  });

  it("el cuerpo de la respuesta no filtra datos del documento", async () => {
    const error = await repositoryOver(CORRUPT_FIELDS)
      .findById("l-1")
      .catch((caught: Error) => caught);

    const text = await handleError(error).text();

    expect(text).not.toContain("DATO-SENSIBLE");
    expect(text).not.toContain("12345");
    expect(text).not.toContain("due_at");
  });

  it("el listado completo también falla con 500 si algún documento está corrupto", async () => {
    const error = await repositoryOver(CORRUPT_FIELDS)
      .listAll()
      .catch((caught: Error) => caught);

    expect(error).not.toBeInstanceOf(ZodError);
    expect(handleError(error).status).toBe(500);
  });

  it("falta un campo obligatorio: también 500", async () => {
    const withoutBook = {
      member_id: "m-1",
      loaned_at: VALID_FIELDS.loaned_at,
      due_at: VALID_FIELDS.due_at,
      returned_at: null,
    };
    const error = await repositoryOver(withoutBook)
      .findById("l-1")
      .catch((caught: Error) => caught);

    expect(handleError(error).status).toBe(500);
  });
});
