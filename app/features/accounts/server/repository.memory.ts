import type { Id, Role } from "@/shared/schema";
import { ConflictError } from "@/shared/server/errors";
import type { MemberRecord, MemberRepository } from "./repository";

class MemoryMembers implements MemberRepository {
  private readonly rows = new Map<Id, MemberRecord>();

  async create(record: MemberRecord) {
    if (this.rows.has(record.id)) {
      throw new ConflictError("Ya existe una cuenta con ese id");
    }
    if (record.role === "ADMINISTRADOR" && (await this.existsWithRole("ADMINISTRADOR"))) {
      throw new ConflictError("Ya existe un administrador");
    }
    this.rows.set(record.id, { ...record });
    return { ...record };
  }

  async findById(id: Id) {
    const row = this.rows.get(id);
    return row && { ...row };
  }

  async findByEmail(email: string) {
    const row = [...this.rows.values()].find((member) => member.email === email);
    return row && { ...row };
  }

  async existsWithRole(role: Role) {
    return [...this.rows.values()].some((member) => member.role === role);
  }

  async list() {
    return [...this.rows.values()].map((member) => ({ ...member }));
  }
}

/** Repositorio en memoria: rápido y sin red; se usa en las pruebas unitarias. El `id` es el uid recibido. */
export function createMemoryMemberRepository(): MemberRepository {
  return new MemoryMembers();
}
