import { BORROWER_ROLES, type Role } from "@/shared/schema";
import type { MemberRecord } from "./repository";

/** Longitud máxima de los prefijos guardados en `search_keys` (B4). */
export const MAX_KEY_LENGTH = 20;
const MIN_KEY_LENGTH = 2;

/**
 * B1 · Normaliza el texto (minúsculas, sin tildes) y lo separa en palabras por cualquier
 * carácter que no sea letra o dígito.
 */
export function normalizeWords(text: string): string[] {
  const plain = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return plain.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 0);
}

/** Palabras del nombre y de la parte del correo anterior a `@` (las únicas en las que se busca). */
function searchableWords(name: string, email: string): string[] {
  const local = email.split("@")[0] ?? "";
  return [...normalizeWords(name), ...normalizeWords(local)];
}

/**
 * Palabras de la consulta. Si se escribió un correo completo («ana.ruiz@correo.com»), solo cuenta lo anterior
 * a `@`; si eso no deja palabras, se usan todas las del texto.
 */
export function queryWords(q: string): string[] {
  const beforeAt = normalizeWords(q.split("@")[0] ?? "");
  if (beforeAt.length > 0) {
    return beforeAt;
  }
  return normalizeWords(q);
}

/** La palabra más larga de la consulta, truncada a 20 puntos de código (la que se consulta con `array-contains`). */
export function longestQueryWord(q: string): string {
  let longest: string[] = [];
  for (const word of queryWords(q)) {
    const chars = Array.from(word);
    if (chars.length > longest.length) {
      longest = chars;
    }
  }
  return longest.slice(0, MAX_KEY_LENGTH).join("");
}

/**
 * B1 · `true` si cada palabra de `q` es el comienzo de alguna palabra del nombre o de la parte del correo
 * anterior a `@`. Una consulta sin palabras no coincide con nadie.
 */
export function matchesMemberQuery(record: Pick<MemberRecord, "name" | "email">, q: string): boolean {
  const wanted = queryWords(q);
  if (wanted.length === 0) {
    return false;
  }
  const words = searchableWords(record.name, record.email);
  return wanted.every((prefix) => words.some((word) => word.startsWith(prefix)));
}

/** B4 · Prefijos de 2 a 20 puntos de código de cada palabra del nombre y del correo (sin repetidos ni pares partidos). */
export function buildSearchKeys(name: string, email: string): string[] {
  const keys = new Set<string>();
  for (const word of searchableWords(name, email)) {
    const chars = Array.from(word);
    const longest = Math.min(chars.length, MAX_KEY_LENGTH);
    for (let size = MIN_KEY_LENGTH; size <= longest; size += 1) {
      keys.add(chars.slice(0, size).join(""));
    }
  }
  return [...keys];
}

/** Orden por nombre (español) y recorte a `limit`, compartido por los dos repositorios. */
export function sortAndLimit(records: MemberRecord[], limit: number): MemberRecord[] {
  return records.sort((a, b) => a.name.localeCompare(b.name, "es")).slice(0, limit);
}

/** `true` si el rol puede pedir libros prestados (EXTERNO, ESTUDIANTE o DOCENTE). */
export const isBorrowerRole = (role: Role): boolean => BORROWER_ROLES.some((borrower) => borrower === role);

/** Filtro de `lendable`: sin él pasan todas; con él, solo activas con rol de prestatario. */
export function passesLendable(record: MemberRecord, lendable: boolean): boolean {
  if (!lendable) {
    return true;
  }
  return record.active && isBorrowerRole(record.role);
}
