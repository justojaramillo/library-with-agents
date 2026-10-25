import type { TeacherRequest } from "@/features/accounts/schema";
import type { MemberRoleStore } from "@/features/accounts/server/teacher-request-repository";
import { createMemoryTeacherRequestRepository } from "@/features/accounts/server/teacher-request-repository.memory";
import { createTeacherRequestService } from "@/features/accounts/server/teacher-request-service";
import type { Role, SessionUser } from "@/shared/schema";
import { aProvisionedMember, makeWorld, type World } from "./factories";

/** Instante fijo de las pruebas de F11–F12 (el reloj real nunca se usa). */
export const T0 = new Date("2026-01-10T10:00:00.000Z");
export const DAY_MS = 86_400_000;
/** Nota válida (más de 10 caracteres) para las solicitudes de las pruebas. */
export const NOTE = "Docente de Ingeniería, Universidad Nacional";

/** Una cuenta creada para la prueba: su sesión (`actor`) y los datos que el listado debe mostrar. */
export type Person = { id: string; name: string; email: string; role: Role; actor: SessionUser };

type PersonOptions = { verified?: boolean; name?: string };

/** Resultado de una promesa que puede fallar, para comparar carreras sin tocar `any` (`allSettled` lo deja pasar). */
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: Error };

function toError<T>(error: T): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error("Se lanzó algo que no es un Error");
}

/** Espera la promesa y devuelve su resultado o el error que lanzó. */
export async function outcomeOf<T>(promise: Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

/** Cuántos resultados salieron bien. */
export function countOk<T>(outcomes: Outcome<T>[]): number {
  return outcomes.filter((outcome) => outcome.ok).length;
}

/**
 * Mundo de F11–F12: repositorios e identidad en memoria (los de `makeWorld`) más el repositorio y el servicio de
 * solicitudes. Las cuentas se ven a través de `accounts`, que permite desactivar una cuenta sin tocar el
 * repositorio de producción (la memoria no tiene «desactivar»).
 */
export function makeTeacherWorld(world: World = makeWorld()) {
  const inactive = new Set<string>();
  const accounts: MemberRoleStore = {
    async findById(id) {
      const row = await world.repos.members.findById(id);
      if (row === undefined) {
        return undefined;
      }
      return { ...row, active: row.active && !inactive.has(id) };
    },
    setRole: (id, role) => world.repos.members.setRole(id, role),
  };
  const requests = createMemoryTeacherRequestRepository(accounts);
  const service = createTeacherRequestService({ requests, members: world.repos.members, identity: world.identity });

  /** Crea la cuenta (con identidad) con ese rol; por defecto con el correo verificado. */
  async function addPerson(role: Role, options: PersonOptions = {}): Promise<Person> {
    const input = aProvisionedMember({ role });
    if (options.name !== undefined) {
      input.name = options.name;
    }
    const created = await world.members.provision(input);
    if (options.verified !== false) {
      world.identity.markEmailVerified(created.id);
    }
    return {
      id: created.id,
      name: created.name,
      email: created.email,
      role,
      actor: { member_id: created.id, role },
    };
  }

  /** La persona envía su solicitud en ese instante. */
  function ask(person: Person, now: Date = T0, note: string = NOTE): Promise<TeacherRequest> {
    return service.request(person.actor, { note }, now);
  }

  /** El rol que la cuenta tiene guardado ahora (lo que la sesión leería en la siguiente petición). */
  async function roleOf(person: Person): Promise<Role | undefined> {
    return (await world.repos.members.findById(person.id))?.role;
  }

  function deactivate(person: Person): void {
    inactive.add(person.id);
  }

  return { ...world, accounts, requests, service, addPerson, ask, roleOf, deactivate };
}
export type TeacherWorld = ReturnType<typeof makeTeacherWorld>;
