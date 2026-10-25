import type { Id, Role } from "@/shared/schema";

/** Cuenta tal como se guarda. No lleva contraseña ni hash: viven solo en Firebase Authentication. `id` es el `uid`. */
export type MemberRecord = {
  id: Id;
  name: string;
  email: string;
  role: Role;
  active: boolean;
};

/** Una página de cuentas del repositorio: `hasMore` es `true` si existe al menos una cuenta más después de la última. */
export type MemberRecordPage = { members: MemberRecord[]; hasMore: boolean };

/** Resultado de una búsqueda: `truncated` es `true` si se alcanzó el tope de lectura y puede haber más coincidencias. */
export type MemberSearchResult = { members: MemberRecord[]; truncated: boolean };

export interface MemberRepository {
  /**
   * Guarda la cuenta con el `id` (uid) recibido. Lanza `ConflictError` si ya existe ese id o si el rol es
   * ADMINISTRADOR y ya hay uno.
   */
  create(record: MemberRecord): Promise<MemberRecord>;
  findById(id: Id): Promise<MemberRecord | undefined>;
  findByEmail(email: string): Promise<MemberRecord | undefined>;
  /** Las cuentas con esos ids (ya sin repetidos, hasta 500). Las inexistentes se omiten; el orden no está garantizado. */
  findByIds(ids: Id[]): Promise<MemberRecord[]>;
  /** `true` si ya hay al menos una cuenta con ese rol (se usa para el único ADMINISTRADOR). */
  existsWithRole(role: Role): Promise<boolean>;
  /**
   * S1 · Hasta `limit` cuentas ordenadas por nombre y luego por id, a partir de la que sigue a `after` (id de la
   * última cuenta de la página anterior). Lee `limit + 1` para calcular `hasMore`. Lanza un error de validación
   * (`ZodError`, 400) si `after` no existe.
   */
  list(limit: number, after?: Id): Promise<MemberRecordPage>;
  /**
   * B1–B4 · Cuentas cuyo nombre o correo coincide con `q` (cada palabra de `q` es el comienzo de alguna palabra),
   * ordenadas por nombre y recortadas a `limit`. Con `lendable`, solo cuentas activas con rol de prestatario.
   * `truncated` es `true` si se leyeron los 200 documentos del tope (puede haber más); en memoria siempre `false`.
   */
  search(q: string, limit: number, lendable: boolean): Promise<MemberSearchResult>;
  /**
   * F14 · Actualiza SOLO el campo `active` de la cuenta (no toca `search_keys` ni otros campos). Devuelve la cuenta
   * ya actualizada, o `undefined` si no existe.
   */
  setActive(id: Id, active: boolean): Promise<MemberRecord | undefined>;
  /**
   * F13 · Hasta `limit` cuentas cuyo rol está en `roles`, ordenadas por nombre y luego por id. En Firestore la consulta
   * es `role in [...]` con `limit` y SIN orden (así no necesita índice compuesto) y se ordena después: si hubiera más de
   * `limit` cuentas con esos roles, el corte sería arbitrario (la spec fija 200 y el personal es poco).
   */
  listByRoles(roles: Role[], limit: number): Promise<MemberRecord[]>;
}
