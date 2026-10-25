import { z } from "zod";
import { IdSchema, type Id } from "@/shared/schema";
import { ConflictError } from "@/shared/server/errors";
import { describeLoggedError } from "@/shared/server/security/error-log";
import {
  CreateMemberInputSchema,
  ProvisionMemberInputSchema,
  type CreateMemberInput,
  type ListMembersQuery,
  type Member,
  type MemberPage,
  type SearchMembersQuery,
  type ProvisionMemberInput,
} from "../schema";
import type { IdentityProvider } from "./identity";
import type { MemberRecord, MemberRepository } from "./repository";

/** Copia pública de la cuenta (el registro ya no lleva contraseña ni hash). */
export const toPublicMember = (record: MemberRecord): Member => ({
  id: record.id,
  name: record.name,
  email: record.email,
  role: record.role,
  active: record.active,
});

/** Lo que las rutas HTTP pueden usar: nunca crea cuentas con roles de personal. */
export type MemberService = {
  /** F3 · Registrar cuenta. Solo roles seleccionables (EXTERNO | ESTUDIANTE). ConflictError si el correo existe. */
  register(input: CreateMemberInput): Promise<Member>;
  /** La cuenta pública con ese id (uid), o `undefined` si no existe. */
  get(id: string): Promise<Member | undefined>;
  /**
   * S1 · Una página de cuentas (orden por nombre y luego id). La consulta ya viene validada con `ListMembersQuerySchema`.
   * `next_after` es el id de la última cuenta si hay más, o `null`. Un `after` inexistente da un error de validación (400).
   * No comprueba al actor: quien la llame debe exigir personal antes.
   */
  list(query: ListMembersQuery): Promise<MemberPage>;
  /**
   * B1–B4 · Búsqueda de personas por nombre o correo (la consulta ya viene validada con `SearchMembersQuerySchema`).
   * `truncated` avisa de que se alcanzó el tope de lectura y puede haber más coincidencias.
   */
  search(query: SearchMembersQuery): Promise<{ members: Member[]; truncated: boolean }>;
  /** Lectura por lote (F34–F35): las cuentas públicas con esos ids, en el orden recibido. Sin repetidos ni inexistentes; máximo 500 ids (si no, error de validación → 400). */
  getMany(ids: Id[]): Promise<Member[]>;
};

/** Tope de ids por llamada (el máximo de `getAll` en Firestore). */
const MAX_BATCH_IDS = 500;
const BatchIdsSchema = z.array(IdSchema).max(MAX_BATCH_IDS);

/** Alta con cualquier rol. Solo para scripts (seed) y servicios que ya validaron al actor; ninguna ruta lo recibe. */
export type MemberAdminService = {
  provision(input: ProvisionMemberInput): Promise<Member>;
};

export type MemberServiceDeps = { members: MemberRepository; identity: IdentityProvider };

/** Compensación: si no se pudo guardar la cuenta, la identidad recién creada se borra para no dejar huérfanos. */
async function rollbackIdentity(identity: IdentityProvider, uid: string): Promise<void> {
  try {
    await identity.deleteUser(uid);
  } catch (error) {
    console.error(`No se pudo borrar la identidad ${uid} tras un alta fallida:`, describeLoggedError(error));
  }
}

/** Lógica común de `register` y `provision`: correo único, un solo ADMINISTRADOR, identidad en Firebase, cuenta activa. */
async function createAccount(deps: MemberServiceDeps, input: ProvisionMemberInput): Promise<Member> {
  if (await deps.members.findByEmail(input.email)) {
    throw new ConflictError("Ese correo ya está registrado");
  }
  if (input.role === "ADMINISTRADOR" && (await deps.members.existsWithRole("ADMINISTRADOR"))) {
    throw new ConflictError("Ya existe un administrador; solo puede haber uno");
  }
  const { uid } = await deps.identity.createUser({ email: input.email, password: input.password, name: input.name });
  try {
    const record = await deps.members.create({
      id: uid,
      name: input.name,
      email: input.email,
      role: input.role,
      active: true,
    });
    return toPublicMember(record);
  } catch (error) {
    await rollbackIdentity(deps.identity, uid);
    throw error;
  }
}

/** Crea ambos servicios en un solo objeto; quien lo conecta decide cuál de los dos expone (ver el contenedor). */
export function createMemberService(deps: MemberServiceDeps): MemberService & MemberAdminService {
  return {
    register: async (input) => createAccount(deps, CreateMemberInputSchema.parse(input)),
    provision: async (input) => createAccount(deps, ProvisionMemberInputSchema.parse(input)),
    async get(id) {
      const record = await deps.members.findById(id);
      return record && toPublicMember(record);
    },
    async list(query) {
      const page = await deps.members.list(query.limit, query.after);
      const members = page.members.map(toPublicMember);
      const last = members.at(-1);
      if (!page.hasMore || last === undefined) {
        return { members, next_after: null };
      }
      return { members, next_after: last.id };
    },
    async search(query) {
      const found = await deps.members.search(query.q, query.limit, query.lendable);
      return { members: found.members.map(toPublicMember), truncated: found.truncated };
    },
    async getMany(ids) {
      const unique = [...new Set(BatchIdsSchema.parse(ids))];
      const records = await deps.members.findByIds(unique);
      const byId = new Map(records.map((record) => [record.id, toPublicMember(record)]));
      return unique.flatMap((id) => byId.get(id) ?? []);
    },
  };
}
