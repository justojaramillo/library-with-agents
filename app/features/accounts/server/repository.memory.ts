import type { Id, Role } from "@/shared/schema";
import { ConflictError } from "@/shared/server/errors";
import { comparePageOrder, unknownCursorError } from "./member-paging";
import { matchesMemberQuery, passesLendable, sortAndLimit } from "./member-search";
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

  async findByIds(ids: Id[]) {
    const wanted = new Set(ids);
    return [...this.rows.values()].filter((row) => wanted.has(row.id)).map((row) => ({ ...row }));
  }

  async findByEmail(email: string) {
    const row = [...this.rows.values()].find((member) => member.email === email);
    return row && { ...row };
  }

  async existsWithRole(role: Role) {
    return [...this.rows.values()].some((member) => member.role === role);
  }

  async list(limit: number, after?: Id) {
    const sorted = [...this.rows.values()].sort(comparePageOrder);
    let start = 0;
    if (after !== undefined) {
      const index = sorted.findIndex((member) => member.id === after);
      if (index === -1) {
        throw unknownCursorError();
      }
      start = index + 1;
    }
    const window = sorted.slice(start, start + limit + 1);
    return { members: window.slice(0, limit).map((member) => ({ ...member })), hasMore: window.length > limit };
  }

  async search(q: string, limit: number, lendable: boolean) {
    const found = [...this.rows.values()]
      .filter((member) => matchesMemberQuery(member, q))
      .filter((member) => passesLendable(member, lendable))
      .map((member) => ({ ...member }));
    return { members: sortAndLimit(found, limit), truncated: false };
  }
}

/** Repositorio en memoria: rápido y sin red; se usa en las pruebas unitarias. El `id` es el uid recibido. */
export function createMemoryMemberRepository(): MemberRepository {
  return new MemoryMembers();
}
