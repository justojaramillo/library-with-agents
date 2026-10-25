import type { BookRecord } from "./repository";

/**
 * Forma canónica de un texto de búsqueda: recortado, en minúsculas y con los espacios internos colapsados.
 * La usan el filtro (para texto y consulta) y la clave de la caché del catálogo (S1, regla 13), de modo que
 * `Dune`, `dune` y ` DUNE ` den el mismo resultado y la misma clave.
 */
export function normalizeBookText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * F2 · Filtro puro de búsqueda, compartido por los repositorios: coincidencia parcial en título o
 * autor, sin distinguir mayúsculas ni espacios repetidos; `%` y `_` son texto literal; `""` deja pasar todo.
 * El resultado va ordenado por título y, si hay `limit`, recortado a ese tope tras ordenar.
 */
export function filterBooks(records: BookRecord[], q: string, limit?: number): BookRecord[] {
  const needle = normalizeBookText(q);
  const sorted = records
    .filter((book) => normalizeBookText(book.title).includes(needle) || normalizeBookText(book.author).includes(needle))
    .sort((a, b) => a.title.localeCompare(b.title));
  if (limit === undefined) {
    return sorted;
  }
  return sorted.slice(0, limit);
}
