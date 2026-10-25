import { unstable_rethrow } from "next/navigation";
import { headers } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { getContainer } from "@/features/container";
import { BookList } from "@/features/catalog/ui/book-list";
import { SearchBooksQuerySchema } from "@/features/catalog/schema";
import { SearchForm } from "@/features/catalog/ui/search-form";
import { TooManyRequestsError } from "@/shared/server/errors";
import { clientKey, enforceRateLimit } from "@/shared/server/security/rate-limit";

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

/** Si el error es de límite de tasa devuelve los segundos de espera; cualquier otro error se propaga. */
function readRetryAfter<T>(error: T): number {
  unstable_rethrow(error);
  if (error instanceof TooManyRequestsError) {
    return error.retryAfterSeconds;
  }
  throw error;
}

/** Cuenta la búsqueda en el límite de tasa (S1, regla 12). Devuelve los segundos de espera, o `null` si puede seguir. */
async function checkSearchLimit(): Promise<number | null> {
  const requestHeaders = await headers();
  try {
    enforceRateLimit("catalogSearch", clientKey({ headers: requestHeaders }), new Date());
    return null;
  } catch (error) {
    return readRetryAfter(error);
  }
}

/** Aviso cuando se superó el límite de búsquedas; sustituye a la lista. */
function RateLimitNotice({ retryAfterSeconds }: { retryAfterSeconds: number }) {
  return (
    <p role="alert" className="rounded-md border border-control-border bg-surface p-4 text-ink">
      Demasiadas búsquedas seguidas. Espera {retryAfterSeconds} segundos e inténtalo de nuevo.
    </p>
  );
}

/** Parte dinámica: lee `searchParams` (dato de la petición), por eso va dentro de `<Suspense>`. */
async function CatalogContent({ searchParams }: { searchParams: HomeSearchParams }) {
  const params = await searchParams;
  // Con partialPrefetching el prerender ya trae `searchParams`; esperar la conexión evita prerenderizar la lectura de Firestore.
  await connection();
  const q = parseQuery(params.q);
  const retryAfterSeconds = await checkSearchLimit();
  if (retryAfterSeconds !== null) {
    return (
      <>
        <SearchForm q={q} />
        <RateLimitNotice retryAfterSeconds={retryAfterSeconds} />
      </>
    );
  }
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
