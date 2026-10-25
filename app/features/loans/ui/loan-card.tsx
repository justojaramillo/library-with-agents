import { formatCop, formatDaysLate } from "./format";
import { LocalDate } from "./local-date";
import type { LoanRow } from "./loan-rows";

export type LoanCardVariant = "active" | "overdue";

const ICON_PATHS = {
  ok: "m5 12.5 4.5 4.5L19 7.5",
  late: "M12 8v5m0 3.5h.01M12 3 2 20h20L12 3Z",
} as const;

/** Icono decorativo: el estado siempre se dice también con texto (WCAG 1.4.1). */
function StatusIcon({ kind }: { kind: keyof typeof ICON_PATHS }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={ICON_PATHS[kind]} />
    </svg>
  );
}

function OnTimeStatus() {
  return (
    <p className="flex items-center gap-2 font-medium text-success">
      <StatusIcon kind="ok" />
      <strong className="font-semibold">En plazo</strong>
    </p>
  );
}

function OverdueStatus({ row }: { row: LoanRow }) {
  return (
    <>
      <p className="flex items-center gap-2 font-medium text-danger">
        <StatusIcon kind="late" />
        <strong className="font-semibold">Vencido hace {formatDaysLate(row.days_late)}</strong>
      </p>
      <p className="text-danger">Multa acumulada: {formatCop(row.fine_cop)}</p>
    </>
  );
}

function LoanStatus({ row }: { row: LoanRow }) {
  if (row.days_late >= 1) {
    return <OverdueStatus row={row} />;
  }
  return <OnTimeStatus />;
}

function LoanDates({ row, variant }: { row: LoanRow; variant: LoanCardVariant }) {
  return (
    <dl className="text-ink-muted">
      {variant === "active" && (
        <div>
          <dt className="inline">Prestado el: </dt>
          <dd className="inline">
            <LocalDate iso={row.loaned_at} />
          </dd>
        </div>
      )}
      <div>
        <dt className="inline">Vence el: </dt>
        <dd className="inline">
          <LocalDate iso={row.due_at} withTime />
        </dd>
      </div>
    </dl>
  );
}

/**
 * Tarjeta de solo lectura de un préstamo (F35): libro, autor, fechas y estado.
 * Sin botones de acción (renovar es F24). Las fechas se muestran en la hora local del navegador.
 */
export function LoanCard({ row, variant = "active" }: { row: LoanRow; variant?: LoanCardVariant }) {
  return (
    <li>
      <article className="h-full space-y-2 rounded border border-line bg-surface p-4">
        <h2 className="break-words text-lg font-semibold">{row.book_title}</h2>
        <p className="break-words text-ink-muted">{row.book_author}</p>
        <LoanDates row={row} variant={variant} />
        <LoanStatus row={row} />
      </article>
    </li>
  );
}
