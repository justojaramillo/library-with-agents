import Link from "next/link";
import { BORROWER_ROLES, STAFF_ROLES, type BorrowerRole, type Role } from "@/shared/schema";
import { LogoutButton } from "./logout-button";
import { ROLE_LABELS } from "./role-labels";

export interface NavBarUser {
  name: string;
  role: Role;
}

const NAV_LINK_CLASS =
  "inline-flex min-h-11 items-center rounded px-3 text-surface underline-offset-4 hover:bg-primary-hover hover:underline";

/** Solo para mostrar u ocultar enlaces; el servidor valida de verdad. */
function isStaff(role: Role): boolean {
  return (STAFF_ROLES as readonly Role[]).includes(role);
}

function isBorrower(role: Role): role is BorrowerRole {
  return (BORROWER_ROLES as readonly Role[]).includes(role);
}

function NavItem({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <Link href={href} className={NAV_LINK_CLASS}>
        {label}
      </Link>
    </li>
  );
}

function StaffLinks({ role }: { role: Role }) {
  if (!isStaff(role)) {
    return null;
  }
  return (
    <>
      <NavItem href="/prestamos" label="Préstamos" />
      <NavItem href="/cuentas" label="Cuentas" />
      <NavItem href="/solicitudes" label="Solicitudes" />
    </>
  );
}

/** F11 · Regla 18: quien aún no es docente ve «Ser docente»; quien ya lo es, «Mi rol de docente». */
const TEACHER_LINK_LABELS: Record<BorrowerRole, string> = {
  EXTERNO: "Ser docente",
  ESTUDIANTE: "Ser docente",
  DOCENTE: "Mi rol de docente",
};

function BorrowerLinks({ role }: { role: Role }) {
  if (!isBorrower(role)) {
    return null;
  }
  return (
    <>
      <NavItem href="/mis-prestamos" label="Mis préstamos" />
      <NavItem href="/mis-vencidos" label="Mis vencidos" />
      <NavItem href="/docente" label={TEACHER_LINK_LABELS[role]} />
    </>
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

/** Barra principal: «Biblioteca» siempre, «Préstamos», «Cuentas» y «Solicitudes» (sin contador) al personal, «Mis préstamos», «Mis vencidos» y «Ser docente»/«Mi rol de docente» a quien pide prestado, y el área de sesión a la derecha. */
export function NavBar({ user }: { user: NavBarUser | null }) {
  const role = user?.role;
  return (
    <ul className="flex flex-wrap items-center gap-x-1 gap-y-1 py-2">
      <li>
        <Link href="/" className={`${NAV_LINK_CLASS} font-semibold`}>
          Biblioteca
        </Link>
      </li>
      {role !== undefined && <StaffLinks role={role} />}
      {role !== undefined && <BorrowerLinks role={role} />}
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
