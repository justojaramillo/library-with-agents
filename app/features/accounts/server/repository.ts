import type { Id, Role } from "@/shared/schema";

/** Cuenta tal como se guarda. No lleva contraseña ni hash: viven solo en Firebase Authentication. `id` es el `uid`. */
export type MemberRecord = {
  id: Id;
  name: string;
  email: string;
  role: Role;
  active: boolean;
};

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
  list(): Promise<MemberRecord[]>;
  /**
   * B1–B4 · Cuentas cuyo nombre o correo coincide con `q` (cada palabra de `q` es el comienzo de alguna palabra),
   * ordenadas por nombre y recortadas a `limit`. Con `lendable`, solo cuentas activas con rol de prestatario.
   */
  search(q: string, limit: number, lendable: boolean): Promise<MemberRecord[]>;
}
