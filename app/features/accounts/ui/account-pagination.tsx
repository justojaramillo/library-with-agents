import Link from "next/link";

const LINK_CLASS =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded border border-control-border bg-surface px-4 font-medium text-primary underline-offset-4 hover:bg-surface-alt hover:underline";

type AccountPaginationProps = {
  /** Cursor de la página siguiente, o `null` si esta es la última. */
  nextAfter: string | null;
  /** Si la dirección trae cursor, se ofrece volver a la primera página. */
  hasCursor: boolean;
};

function NextLink({ nextAfter }: { nextAfter: string | null }) {
  if (nextAfter === null) {
    return null;
  }
  return (
    <li>
      <Link href={`/cuentas?after=${encodeURIComponent(nextAfter)}`} className={LINK_CLASS}>
        Siguiente
      </Link>
    </li>
  );
}

function HomeLink({ hasCursor }: { hasCursor: boolean }) {
  if (!hasCursor) {
    return null;
  }
  return (
    <li>
      <Link href="/cuentas" className={LINK_CLASS}>
        Volver al inicio
      </Link>
    </li>
  );
}

/** Navegación entre páginas de cuentas (S1, regla 6): «Volver al inicio» y «Siguiente». */
export function AccountPagination({ nextAfter, hasCursor }: AccountPaginationProps) {
  if (nextAfter === null && !hasCursor) {
    return null;
  }
  return (
    <nav aria-label="Paginación de cuentas">
      <ul className="flex flex-wrap gap-3">
        <HomeLink hasCursor={hasCursor} />
        <NextLink nextAfter={nextAfter} />
      </ul>
    </nav>
  );
}

/** Aviso cuando el cursor no corresponde a ninguna cuenta. */
export function PageNotFound() {
  return (
    <div className="grid gap-3">
      <p role="alert" className="font-medium text-danger">
        No se encontró esa página. Vuelve al inicio.
      </p>
      <nav aria-label="Paginación de cuentas">
        <Link href="/cuentas" className={`${LINK_CLASS} justify-self-start`}>
          Volver al inicio
        </Link>
      </nav>
    </div>
  );
}
