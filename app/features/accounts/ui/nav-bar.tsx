import Link from "next/link";
import { STAFF_ROLES, type Role } from "@/shared/schema";
import { LogoutButton } from "./logout-button";
import { ROLE_LABELS } from "./role-labels";

export interface NavBarUser {
  name: string;
  role: Role;
}

const NAV_LINK_CLASS =
  "inline-flex min-h-11 items-center rounded px-3 text-surface underline-offset-4 hover:bg-primary-hover hover:underline";

/** Solo para mostrar u ocultar el enlace; el servidor valida de verdad. */
function isStaff(role: Role): boolean {
  return (STAFF_ROLES as readonly Role[]).includes(role);
}

function AccountsLink({ role }: { role: Role }) {
  if (!isStaff(role)) {
    return null;
  }
  return (
    <li>
      <Link href="/cuentas" className={NAV_LINK_CLASS}>
        Cuentas
      </Link>
    </li>
  );
}

function SessionArea({ user }: { user: NavBarUser | null }) {
  if (user === null) {
    return (
      <li className="ml-auto">
        <Link href="/login" className={NAV_LINK_CLASS}>
          Ingresar
        </Link>
      </li>
    );
  }
  return (
    <li className="ml-auto flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-1">
      <p className="min-w-0 break-words">
        <strong className="break-words font-semibold">{user.name}</strong>{" "}
        <small className="text-surface">({ROLE_LABELS[user.role]})</small>
      </p>
      <LogoutButton />
    </li>
  );
}

/** Barra principal: «Biblioteca» siempre, «Cuentas» solo al personal y el área de sesión a la derecha. */
export function NavBar({ user }: { user: NavBarUser | null }) {
  const role = user?.role;
  return (
    <ul className="flex flex-wrap items-center gap-x-1 gap-y-1 py-2">
      <li>
        <Link href="/" className={`${NAV_LINK_CLASS} font-semibold`}>
          Biblioteca
        </Link>
      </li>
      {role !== undefined && <AccountsLink role={role} />}
      <SessionArea user={user} />
    </ul>
  );
}

/** Barra mínima mientras se lee la sesión (fallback de `<Suspense>`). */
export function NavBarFallback() {
  return (
    <ul className="flex flex-wrap items-center gap-x-1 gap-y-1 py-2">
      <li>
        <Link href="/" className={`${NAV_LINK_CLASS} font-semibold`}>
          Biblioteca
        </Link>
      </li>
    </ul>
  );
}
