/** Búsqueda por título o autor: formulario GET, funciona sin JavaScript en el cliente. */
export function SearchForm({ q }: { q: string }) {
  return (
    <form action="/" method="get" role="search" className="grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
      <div className="grid gap-1">
        <label htmlFor="q" className="font-medium">
          Título o autor
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={q}
          className="min-h-11 w-full rounded border border-control-border bg-surface px-3 text-ink"
        />
      </div>
      <button
        type="submit"
        className="min-h-11 min-w-11 rounded bg-primary px-4 font-medium text-surface hover:bg-primary-hover"
      >
        Buscar
      </button>
    </form>
  );
}
