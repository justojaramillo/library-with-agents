import { ZodError } from "zod";
import type { MemberRecord } from "./repository";

/** Orden de las páginas: por nombre y, a igual nombre, por id (orden de código, igual que Firestore). */
export function comparePageOrder(a: MemberRecord, b: MemberRecord): number {
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
}

/** Error de validación (→ 400) cuando el cursor `after` no corresponde a ninguna cuenta. */
export function unknownCursorError(): ZodError {
  return new ZodError([{ code: "custom", path: ["after"], message: "El cursor «after» no existe", input: undefined }]);
}

/** F13 · Orden del listado de personal: nombre en español (sin distinguir mayúsculas ni acentos) y luego id. */
export function compareByNameThenId(a: MemberRecord, b: MemberRecord): number {
  const byName = a.name.localeCompare(b.name, "es", { sensitivity: "base" });
  if (byName !== 0) {
    return byName;
  }
  if (a.id < b.id) {
    return -1;
  }
  if (a.id > b.id) {
    return 1;
  }
  return 0;
}
