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
  /** `true` si ya hay al menos una cuenta con ese rol (se usa para el único ADMINISTRADOR). */
  existsWithRole(role: Role): Promise<boolean>;
  list(): Promise<MemberRecord[]>;
}
