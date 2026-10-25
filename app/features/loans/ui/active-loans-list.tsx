import { ROLE_LABELS } from "@/features/accounts/ui/role-labels";
import { formatCop, formatDaysLate } from "./format";
import { LocalDate } from "./local-date";
import type { LoanRow } from "./loan-rows";
import { ReturnButton, ReturnNotice, ReturnNoticeProvider } from "./return-button";

const ICON_CLASS = "mt-1 size-4 shrink-0";

/** Estado del préstamo: nunca solo con color, siempre icono y texto. */
function LoanStatus({ row }: { row: LoanRow }) {
  if (row.days_late === 0) {
    return (
      <p className="flex items-start gap-2 font-medium text-success">
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className={ICON_CLASS}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M3 8.5l3.5 3.5L13 4.5" />
        </svg>
        En plazo
      </p>
    );
  }
  return (
    <div className="grid gap-1 text-danger">
      <p className="flex items-start gap-2 font-medium">
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className={ICON_CLASS}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M8 2l6.5 11.5h-13zM8 6.5v3M8 11.5v.5" />
        </svg>
        Vencido hace {formatDaysLate(row.days_late)}
      </p>
      <p className="font-medium">Multa acumulada: {formatCop(row.fine_cop)}</p>
    </div>
  );
}

function memberText(row: LoanRow): string {
  if (row.member_role === null) {
    return row.member_name;
  }
  return `${row.member_name} (${ROLE_LABELS[row.member_role]})`;
}

function LoanItem({ row }: { row: LoanRow }) {
  return (
    <li>
      <article className="flex h-full flex-col gap-3 rounded border border-line bg-surface p-4">
        <h3 className="text-lg font-semibold break-words">{row.book_title}</h3>
        <dl className="grid gap-1 text-ink-muted">
          <div>
            <dt className="sr-only">Autor</dt>
            <dd className="break-words">{row.book_author}</dd>
          </div>
          <div>
            <dt className="inline text-ink">Persona: </dt>
            <dd className="inline break-words">{memberText(row)}</dd>
          </div>
          <div>
            <dt className="inline text-ink">Prestado el: </dt>
            <dd className="inline">
              <LocalDate iso={row.loaned_at} />
            </dd>
          </div>
          <div>
            <dt className="inline text-ink">Vence el: </dt>
            <dd className="inline">
              <LocalDate iso={row.due_at} withTime />
            </dd>
          </div>
        </dl>
        <LoanStatus row={row} />
        <ReturnButton loanId={row.loan_id} bookTitle={row.book_title} />
      </article>
    </li>
  );
}

/** Lista de préstamos activos (ya ordenados por vencimiento): 1 columna a 360 px, 2 desde 768 px y 3 desde 1024 px. */
export function ActiveLoansList({ rows }: { rows: LoanRow[] }) {
  if (rows.length === 0) {
    return (
      <ReturnNoticeProvider>
        <ReturnNotice />
        <p className="text-ink-muted">No hay préstamos activos.</p>
      </ReturnNoticeProvider>
    );
  }
  return (
    <ReturnNoticeProvider>
      <ReturnNotice />
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <LoanItem key={row.loan_id} row={row} />
        ))}
      </ul>
    </ReturnNoticeProvider>
  );
}
