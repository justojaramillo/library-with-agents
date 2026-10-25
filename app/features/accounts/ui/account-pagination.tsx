import Link from "next/link";

const LINK_CLASS =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded border border-control-border bg-surface px-4 font-medium text-primary underline-offset-4 hover:bg-surface-alt hover:underline";

const DEFAULT_BASE_PATH = "/cuentas";
const DEFAULT_LABEL = "Paginación de cuentas";

/** Ruta y parámetros que se conservan en los enlaces (p. ej. `status` en `/solicitudes`). Sin valores, es `/cuentas`. */
type PaginationTarget = {
  /** Ruta de la pantalla; por defecto `/cuentas`. */
  basePath?: string;
  /** Parámetros fijos de la dirección (sin `after`); se codifican al armar el enlace. */
  extraParams?: Record<string, string>;
  /** Nombre accesible de la navegación; por defecto «Paginación de cuentas». */
  label?: string;
};

type AccountPaginationProps = PaginationTarget & {
  /** Cursor de la página siguiente, o `null` si esta es la última. */
  nextAfter: string | null;
  /** Si la dirección trae cursor, se ofrece volver a la primera página. */
  hasCursor: boolean;
};

/** Dirección de una página: la ruta más los parámetros codificados, o la ruta sola si no hay ninguno. */
export function buildPageHref(basePath: string, params: Record<string, string>): string {
  const pairs = Object.entries(params).map(([key, value]) => `${key}=${encodeURIComponent(value)}`);
  if (pairs.length === 0) {
    return basePath;
  }
  return `${basePath}?${pairs.join("&")}`;
}

function NextLink({ nextAfter, target }: { nextAfter: string | null; target: Required<PaginationTarget> }) {
  if (nextAfter === null) {
    return null;
  }
  const href = buildPageHref(target.basePath, { ...target.extraParams, after: nextAfter });
  return (
    <li>
      <Link href={href} className={LINK_CLASS}>
        Siguiente
      </Link>
    </li>
  );
}

function HomeLink({ hasCursor, target }: { hasCursor: boolean; target: Required<PaginationTarget> }) {
  if (!hasCursor) {
    return null;
  }
  return (
    <li>
      <Link href={buildPageHref(target.basePath, target.extraParams)} className={LINK_CLASS}>
        Volver al inicio
      </Link>
    </li>
  );
}

function withDefaults(target: PaginationTarget): Required<PaginationTarget> {
  return {
    basePath: target.basePath ?? DEFAULT_BASE_PATH,
    extraParams: target.extraParams ?? {},
    label: target.label ?? DEFAULT_LABEL,
  };
}

/** Navegación entre páginas (S1, regla 6): «Volver al inicio» y «Siguiente». Sin opciones, la de `/cuentas`. */
export function AccountPagination({ nextAfter, hasCursor, ...options }: AccountPaginationProps) {
  if (nextAfter === null && !hasCursor) {
    return null;
  }
  const target = withDefaults(options);
  return (
    <nav aria-label={target.label}>
      <ul className="flex flex-wrap gap-3">
        <HomeLink hasCursor={hasCursor} target={target} />
        <NextLink nextAfter={nextAfter} target={target} />
      </ul>
    </nav>
  );
}

/** Aviso cuando el cursor no corresponde a ninguna fila. Sin opciones, el de `/cuentas`. */
export function PageNotFound(options: PaginationTarget) {
  const target = withDefaults(options);
  return (
    <div className="grid gap-3">
      <p role="alert" className="font-medium text-danger">
        No se encontró esa página. Vuelve al inicio.
      </p>
      <nav aria-label={target.label}>
        <Link href={buildPageHref(target.basePath, target.extraParams)} className={`${LINK_CLASS} justify-self-start`}>
          Volver al inicio
        </Link>
      </nav>
    </div>
  );
}
