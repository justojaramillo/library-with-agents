import type { ProvisionMemberInput } from "@/features/accounts/schema";
import type { MemberRepository } from "@/features/accounts/server/repository";
import { createStaffService } from "@/features/accounts/server/staff-service";
import type { Role, SessionUser } from "@/shared/schema";
import { aProvisionedMember, makeWorld, type World } from "./factories";

/** Contraseña de las cuentas que crea `addPerson` (la de `aProvisionedMember`). */
export const PASSWORD = "clave-segura-123";

/** Una cuenta creada para la prueba: su sesión (`actor`) y lo necesario para ingresar. */
export type StaffPerson = {
  id: string;
  name: string;
  email: string;
  role: Role;
  actor: SessionUser;
};

/**
 * Mundo de F13–F14: los repositorios, la identidad y los servicios de `makeWorld` más el servicio de personal real
 * (`createStaffService`) conectado a ellos. Sirve también con un mundo más grande (de préstamos o de solicitudes).
 */
export function makeStaffWorld(world: World = makeWorld()) {
  const staff = createStaffService({ members: world.repos.members, provision: world.members.provision });

  /** Crea la cuenta (con identidad) con ese rol y contraseña `PASSWORD`; se puede sobrescribir cualquier campo. */
  async function addPerson(role: Role, over: Partial<ProvisionMemberInput> = {}): Promise<StaffPerson> {
    const created = await world.members.provision(aProvisionedMember({ role, ...over }));
    return {
      id: created.id,
      name: created.name,
      email: created.email,
      role: created.role,
      actor: { member_id: created.id, role: created.role },
    };
  }

  /** La cuenta tal como está guardada ahora. */
  async function stored(person: { id: string }) {
    return world.repos.members.findById(person.id);
  }

  /** Crea la cuenta y, si hace falta, la deja inactiva (por el repositorio, no por el servicio). */
  async function addWithState(role: Role, active: boolean): Promise<StaffPerson> {
    const person = await addPerson(role);
    if (!active) {
      await world.repos.members.setActive(person.id, false);
    }
    return person;
  }

  /** Cookie de sesión emitida por la identidad en memoria para esa persona (como hace el ingreso real). */
  async function sessionCookieFor(person: StaffPerson): Promise<string> {
    const idToken = await world.identity.signIn(person.email, PASSWORD);
    if (idToken === null) {
      throw new Error(`La identidad no reconoció a ${person.email}`);
    }
    return world.identity.createSessionCookie(idToken, 3600);
  }

  return { ...world, staff, addPerson, addWithState, stored, sessionCookieFor };
}
export type StaffWorld = ReturnType<typeof makeStaffWorld>;

/** Repositorio que delega en otro salvo `create`, que siempre falla (simula una caída de Firestore al guardar). */
export function failingCreateRepository(inner: MemberRepository): MemberRepository {
  return {
    create: async (record) => {
      throw new Error(`Firestore caído al guardar ${record.email}`);
    },
    findById: (id) => inner.findById(id),
    findByIds: (ids) => inner.findByIds(ids),
    findByEmail: (email) => inner.findByEmail(email),
    existsWithRole: (role) => inner.existsWithRole(role),
    list: (limit, after) => inner.list(limit, after),
    search: (q, limit, lendable) => inner.search(q, limit, lendable),
    setActive: (id, active) => inner.setActive(id, active),
    listByRoles: (roles, limit) => inner.listByRoles(roles, limit),
  };
}

/** Un correo válido de exactamente `length` caracteres (local de 64, etiquetas de hasta 63 y «.com»). Para 254 y 255. */
export function emailOfLength(length: number): string {
  const local = "a".repeat(64);
  const domainLength = length - local.length - 1;
  const lastLabel = "c".repeat(domainLength - 63 - 1 - 63 - 1 - ".com".length);
  return `${local}@${"b".repeat(63)}.${"d".repeat(63)}.${lastLabel}.com`;
}
