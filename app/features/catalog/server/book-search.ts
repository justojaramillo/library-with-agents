import type { BookRecord } from "./repository";

/**
 * F2 · Filtro puro de búsqueda, compartido por los repositorios: coincidencia parcial en título o
 * autor, sin distinguir mayúsculas; `%` y `_` son texto literal; `""` deja pasar todo.
 * El resultado va ordenado por título.
 */
export function filterBooks(records: BookRecord[], q: string): BookRecord[] {
  const needle = q.trim().toLowerCase();
  return records
    .filter((book) => book.title.toLowerCase().includes(needle) || book.author.toLowerCase().includes(needle))
    .sort((a, b) => a.title.localeCompare(b.title));
}
