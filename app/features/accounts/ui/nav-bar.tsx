import Link from "next/link";
import { BORROWER_ROLES, STAFF_ROLES, type BorrowerRole, type Role } from "@/shared/schema";
import { LogoutButton } from "./logout-button";
import { CollapsibleLinks, MenuLink, UserMenu } from "./nav-menu";
import { ROLE_LABELS } from "./role-labels";

export interface NavBarUser {
  name: string;
  role: Role;
}

const NAV_LINK_CLASS =
  "inline-flex min-h-11 items-center rounded px-3 text-surface underline-offset-4 hover:bg-primary-hover hover:underline";
const LIST_CLASS = "flex flex-wrap items-center gap-x-1 gap-y-1 py-2";

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
      <MenuLink href={href} label={label} />
    </li>
  );
}

function StaffLinks({ role }: { role: Role }) {
  return (
    <>
      <NavItem href="/prestamos" label="Préstamos" />
      <NavItem href="/cuentas" label="Cuentas" />
      <NavItem href="/solicitudes" label="Solicitudes" />
      <AdminLinks role={role} />
    </>
  );
}

/** F13 · «Personal» solo para el administrador; el bibliotecario no lo ve. */
function AdminLinks({ role }: { role: Role }) {
  if (role !== "ADMINISTRADOR") {
    return null;
  }
  return <NavItem href="/personal" label="Personal" />;
}

/** F11 · Regla 18: quien aún no es docente ve «Ser docente»; quien ya lo es, «Mi rol de docente». */
const TEACHER_LINK_LABELS: Record<BorrowerRole, string> = {
  EXTERNO: "Ser docente",
  ESTUDIANTE: "Ser docente",
  DOCENTE: "Mi rol de docente",
};

function BorrowerLinks({ role }: { role: BorrowerRole }) {
  return (
    <>
      <NavItem href="/mis-prestamos" label="Mis préstamos" />
      <NavItem href="/mis-vencidos" label="Mis vencidos" />
      <NavItem href="/docente" label={TEACHER_LINK_LABELS[role]} />
    </>
  );
}

/** F15 · Los enlaces del rol (personal o prestatario), en línea desde 768 px y tras «Menú» por debajo. Sin sesión no hay ninguno. */
function RoleLinks({ role }: { role: Role | undefined }) {
  if (role === undefined) {
    return null;
  }
  if (isStaff(role)) {
    return (
      <CollapsibleLinks>
        <StaffLinks role={role} />
      </CollapsibleLinks>
    );
  }
  if (isBorrower(role)) {
    return (
      <CollapsibleLinks>
        <BorrowerLinks role={role} />
      </CollapsibleLinks>
    );
  }
  return null;
}

/** Área de sesión (derecha): «Ingresar» sin sesión; con sesión, el menú de usuario con «Cambiar contraseña» y «Cerrar sesión». */
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
    <UserMenu name={user.name} roleLabel={ROLE_LABELS[user.role]}>
      <li>
        <MenuLink href="/contrasena" label="Cambiar contraseña" />
      </li>
      <li>
        <LogoutButton />
      </li>
    </UserMenu>
  );
}

/**
 * Barra principal (F15, reglas 10–12): «Biblioteca» siempre; los enlaces del rol (personal: «Préstamos», «Cuentas»,
 * «Solicitudes» y, solo al administrador, «Personal»; prestatario: «Mis préstamos», «Mis vencidos» y «Ser docente»/«Mi rol de docente»)
 * en línea desde 768 px y tras el botón «Menú» por debajo; y a la derecha «Ingresar» o el menú de usuario.
 */
export function NavBar({ user }: { user: NavBarUser | null }) {
  const role = user?.role;
  return (
    <ul className={LIST_CLASS}>
      <li>
        <Link href="/" className={`${NAV_LINK_CLASS} font-semibold`}>
          Biblioteca
        </Link>
      </li>
      <RoleLinks role={role} />
      <SessionArea user={user} />
    </ul>
  );
}

/** Barra mínima mientras se lee la sesión (fallback de `<Suspense>`). */
export function NavBarFallback() {
  return (
    <ul className={LIST_CLASS}>
      <li>
        <Link href="/" className={`${NAV_LINK_CLASS} font-semibold`}>
          Biblioteca
        </Link>
      </li>
    </ul>
  );
}
