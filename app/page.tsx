import { Suspense } from "react";
import { getContainer } from "@/features/container";
import { BookList } from "@/features/catalog/ui/book-list";
import { SearchBooksQuerySchema } from "@/features/catalog/schema";
import { SearchForm } from "@/features/catalog/ui/search-form";

type HomeSearchParams = PageProps<"/">["searchParams"];

/** Texto de búsqueda: solo se acepta un valor simple; cualquier otra cosa es "sin filtro". */
function readQuery(value: string | string[] | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  return "";
}

/** Valida el texto con el contrato (máx. 100 caracteres); si no es válido, se busca sin filtro. */
function parseQuery(value: string | string[] | undefined): string {
  const parsed = SearchBooksQuerySchema.safeParse({ q: readQuery(value) });
  if (parsed.success) {
    return parsed.data.q;
  }
  return "";
}

/** Parte dinámica: lee `searchParams` (dato de la petición), por eso va dentro de `<Suspense>`. */
async function CatalogContent({ searchParams }: { searchParams: HomeSearchParams }) {
  const params = await searchParams;
  const q = parseQuery(params.q);
  const books = await getContainer().books.search(q);

  return (
    <>
      <SearchForm q={q} />
      <section aria-labelledby="resultados-titulo" className="space-y-4">
        <h2 id="resultados-titulo" className="text-xl font-semibold">
          Libros
        </h2>
        <BookList books={books} />
      </section>
    </>
  );
}

/** F2 · Catálogo con búsqueda. */
export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <section aria-labelledby="catalogo-titulo" className="space-y-6">
      <h1 id="catalogo-titulo" className="text-2xl font-semibold">
        Catálogo
      </h1>
      <Suspense fallback={<p role="status">Cargando catálogo…</p>}>
        <CatalogContent searchParams={searchParams} />
      </Suspense>
    </section>
  );
}
