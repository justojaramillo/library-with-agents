import Link from "next/link";
import type { TeacherRequestStatus } from "../schema";

const TAB_BASE_CLASS = "inline-flex min-h-11 min-w-11 items-center justify-center rounded border px-4 font-medium";
const TAB_ACTIVE_CLASS = `${TAB_BASE_CLASS} border-primary bg-primary text-surface`;
const TAB_IDLE_CLASS = `${TAB_BASE_CLASS} border-control-border bg-surface text-primary underline-offset-4 hover:bg-surface-alt hover:underline`;

/** Enlaces del filtro, en el orden en que se muestran. */
export const REQUEST_STATUS_TABS: readonly { status: TeacherRequestStatus; label: string }[] = [
  { status: "PENDIENTE", label: "Pendientes" },
  { status: "APROBADA", label: "Aprobadas" },
  { status: "RECHAZADA", label: "Rechazadas" },
];

/** Dirección de la pantalla para un estado (primera página). */
export function requestsHref(status: TeacherRequestStatus): string {
  return `/solicitudes?status=${status}`;
}

function TabLink({ status, label, active }: { status: TeacherRequestStatus; label: string; active: boolean }) {
  if (active) {
    return (
      <Link href={requestsHref(status)} aria-current="page" className={TAB_ACTIVE_CLASS}>
        {label}
      </Link>
    );
  }
  return (
    <Link href={requestsHref(status)} className={TAB_IDLE_CLASS}>
      {label}
    </Link>
  );
}

/** F37 · Filtro por estado: «Pendientes», «Aprobadas» y «Rechazadas»; la activa lleva `aria-current="page"`. */
export function RequestStatusNav({ current }: { current: TeacherRequestStatus }) {
  return (
    <nav aria-label="Estado de las solicitudes">
      <ul className="flex flex-wrap gap-3">
        {REQUEST_STATUS_TABS.map((tab) => (
          <li key={tab.status}>
            <TabLink status={tab.status} label={tab.label} active={tab.status === current} />
          </li>
        ))}
      </ul>
    </nav>
  );
}
