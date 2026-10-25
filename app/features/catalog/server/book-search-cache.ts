import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import type { Book } from "../schema";

/** Etiqueta de la caché del catálogo: la invalidan crear libro, prestar y devolver (ADR-0008). */
export const BOOKS_CACHE_TAG = "books";

type SearchBooks = (q: string, limit?: number) => Promise<Book[]>;

declare global {
  // Registro a nivel de proceso (sobrevive a la recarga en caliente, como el contenedor).
  var librarySearchBooks: SearchBooks | undefined;
}

/**
 * El contenedor registra aquí la búsqueda real al construirse. Así la función cacheada no importa
 * `container.ts` (sin ciclo) ni cierra sobre valores no serializables: solo recibe `q` y `limit`.
 */
export function registerBookSearch(search: SearchBooks): void {
  globalThis.librarySearchBooks = search;
}

/** F2 · Búsqueda de libros cacheada 60 s (clave: `q` y `limit`) y etiquetada `books`. */
export async function searchBooksCached(q: string, limit?: number): Promise<Book[]> {
  "use cache";
  cacheLife({ revalidate: 60, expire: 120 });
  cacheTag(BOOKS_CACHE_TAG);
  const search = globalThis.librarySearchBooks;
  if (!search) {
    throw new Error("La búsqueda de libros no está registrada");
  }
  return search(q, limit);
}
