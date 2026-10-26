import { del, get, put } from "@vercel/blob";
import type { ContentStore } from "./repository";

const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";

/**
 * Error genérico del almacén. El mensaje del SDK puede nombrar rutas o direcciones del store, así que no se
 * propaga: solo el nombre del error original y la operación (F27, regla 12).
 */
function storeFailure<T>(operation: string, error: T): Error {
  let name = "desconocido";
  if (error instanceof Error) {
    name = error.name;
  }
  return new Error(`Fallo del almacén de contenido al ${operation} (${name})`);
}

/**
 * `ContentStore` sobre Vercel Blob privado (ADR-0003). El SDK toma el token de `BLOB_READ_WRITE_TOKEN` (o, en
 * Vercel con OIDC, el store de `BLOB_STORE_ID`); este módulo nunca lo lee ni lo registra. El contenido no se sirve
 * por URL: solo se lee desde el servidor. No se usa en pruebas (Blob no tiene emulador).
 */
export function createBlobContentStore(): ContentStore {
  return {
    async put(bookId, markdown) {
      try {
        const stored = await put(`books/${bookId}/content.md`, markdown, {
          access: "private",
          addRandomSuffix: true,
          contentType: MARKDOWN_CONTENT_TYPE,
        });
        return { path: stored.pathname };
      } catch (error) {
        throw storeFailure("guardar", error);
      }
    },
    async get(path) {
      try {
        const found = await get(path, { access: "private", useCache: false });
        if (found === null || found.stream === null) {
          return undefined;
        }
        return await new Response(found.stream).text();
      } catch (error) {
        throw storeFailure("leer", error);
      }
    },
    async remove(path) {
      try {
        await del(path);
      } catch (error) {
        throw storeFailure("borrar", error);
      }
    },
  };
}
