import type { Role } from "@/shared/schema";

/** Quién actúa: su rol y su id salen de la sesión. */
export interface ActiveActor {
  role: Role;
  id: string;
}

/** A quién se quiere cambiar el estado. */
export interface ActiveTarget {
  id: string;
  role: Role;
}

/**
 * F14 · Regla 7: qué botón de estado se ofrece. Solo sirve para mostrar u ocultar; el servidor vuelve a comprobar
 * la matriz y es la barrera real.
 * - Nadie cambia su propia cuenta ni la del administrador.
 * - El administrador cambia a bibliotecarios y prestatarios.
 * - El bibliotecario cambia solo a prestatarios (externo, estudiante, docente).
 */
export function canShowToggle(actorRole: Role, actorId: string, target: ActiveTarget): boolean {
  if (target.id === actorId) {
    return false;
  }
  if (target.role === "ADMINISTRADOR") {
    return false;
  }
  if (actorRole === "ADMINISTRADOR") {
    return true;
  }
  if (actorRole === "BIBLIOTECARIO") {
    return target.role !== "BIBLIOTECARIO";
  }
  return false;
}

/** Estado de una cuenta en palabras. */
export function describeActiveState(active: boolean): string {
  if (active) {
    return "Activa";
  }
  return "Inactiva";
}

/** Aviso de éxito tras cambiar el estado: «{Nombre} ahora está inactiva/activa.». */
export function activeNoticeText(name: string, active: boolean): string {
  if (active) {
    return `${name} ahora está activa.`;
  }
  return `${name} ahora está inactiva.`;
}
