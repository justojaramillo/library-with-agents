import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aBook, makeWorld, type World } from "@/tests/helpers/factories";
import { TooManyRequestsError } from "@/shared/server/errors";
import { resetRateLimits } from "@/shared/server/security/rate-limit";
import Home from "@/page";

/**
 * S1 regla 12 / ADR-0008: la página `/?q=` cuenta cada búsqueda por IP y, si se pasa del límite, muestra un aviso
 * en `role="alert"` junto al formulario, sin ir a `app/error.tsx`. Una página de servidor async no se renderiza
 * entera en Vitest: se llama al componente async de contenido con dobles de `next/headers`, `next/server` y del
 * contenedor, y su resultado se pasa a `renderToStaticMarkup`. Queda sin probar el `<Suspense>` real de Next.
 */
const holder = vi.hoisted(() => ({
  world: null as World | null,
  requestHeaders: new Headers(),
  rateLimitFailure: null as Error | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => holder.requestHeaders }));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("@/features/container", () => ({
  getContainer: () => {
    if (holder.world === null) {
      throw new Error("la prueba no preparó el mundo");
    }
    return { books: holder.world.books };
  },
}));
vi.mock("@/shared/server/security/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/server/security/rate-limit")>();
  return {
    ...actual,
    enforceRateLimit: vi.fn((...args: Parameters<typeof actual.enforceRateLimit>) => {
      if (holder.rateLimitFailure !== null) {
        throw holder.rateLimitFailure;
      }
      actual.enforceRateLimit(...args);
    }),
  };
});

import { enforceRateLimit } from "@/shared/server/security/rate-limit";

const NOW = new Date("2026-03-01T10:00:00.000Z");

function currentWorld(): World {
  if (holder.world === null) {
    throw new Error("sin mundo");
  }
  return holder.world;
}

/** Busca, en el árbol devuelto por `Home`, el elemento cuyo tipo es una función (el contenido async). */
function findContentElement(node: ReactNode): ReactElement<{ searchParams: Promise<{ q?: string }> }> | null {
  if (!isValidElement<{ children?: ReactNode; searchParams?: Promise<{ q?: string }> }>(node)) {
    return null;
  }
  if (typeof node.type === "function" && node.props.searchParams !== undefined) {
    return node as ReactElement<{ searchParams: Promise<{ q?: string }> }>;
  }
  const children = [node.props.children].flat();
  for (const child of children) {
    const found = findContentElement(child);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/** Renderiza la parte dinámica de `/` para la búsqueda `q` y devuelve su HTML. */
async function renderCatalog(q: string): Promise<string> {
  const searchParams = Promise.resolve({ q });
  const tree = Home({ params: Promise.resolve({}), searchParams });
  const content = findContentElement(tree);
  if (content === null) {
    throw new Error("no se encontró el componente de contenido en la página");
  }
  const Content = content.type as (props: { searchParams: Promise<{ q?: string }> }) => Promise<ReactNode>;
  const resolved = await Content({ searchParams });
  return renderToStaticMarkup(resolved);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  resetRateLimits();
  holder.world = makeWorld();
  holder.rateLimitFailure = null;
  holder.requestHeaders = new Headers({ "x-forwarded-for": "203.0.113.7" });
  vi.mocked(enforceRateLimit).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("S1 regla 12 · página de catálogo: límite de tasa", () => {
  it("antes de buscar cuenta la petición en el cubo catalogSearch con la IP del cliente y la hora actual", async () => {
    await renderCatalog("dune");

    expect(enforceRateLimit).toHaveBeenCalledTimes(1);
    expect(enforceRateLimit).toHaveBeenCalledWith("catalogSearch", "203.0.113.7", NOW);
  });

  it("sin IP válida cuenta con la clave «desconocida»", async () => {
    holder.requestHeaders = new Headers();

    await renderCatalog("");

    expect(enforceRateLimit).toHaveBeenCalledWith("catalogSearch", "desconocida", NOW);
  });

  it("dentro del límite muestra el formulario y los libros encontrados, sin aviso", async () => {
    await currentWorld().books.create(aBook({ title: "Dune" }));

    const html = await renderCatalog("dune");

    expect(html).toContain('role="search"');
    expect(html).toContain("Dune");
    expect(html).not.toContain('role="alert"');
  });

  it("la búsqueda número 60 pasa y la 61 muestra el aviso con los segundos de espera", async () => {
    await currentWorld().books.create(aBook({ title: "Dune" }));
    for (let i = 0; i < 60; i += 1) {
      const html = await renderCatalog("dune");
      expect(html).not.toContain('role="alert"');
    }

    const html = await renderCatalog("dune");

    expect(html).toContain('<p role="alert"');
    expect(html).toContain("Demasiadas búsquedas seguidas. Espera 60 segundos e inténtalo de nuevo.");
  });

  it("con el aviso se conserva el formulario con el texto buscado y no se listan libros", async () => {
    await currentWorld().books.create(aBook({ title: "Dune" }));
    holder.rateLimitFailure = new TooManyRequestsError("Demasiadas peticiones", 17);

    const html = await renderCatalog("dune");

    expect(html).toContain('role="search"');
    expect(html).toContain('value="dune"');
    expect(html).toContain("Espera 17 segundos");
    expect(html).not.toContain("resultados-titulo");
  });

  it("con el límite superado no se consulta el catálogo", async () => {
    const searchSpy = vi.spyOn(currentWorld().books, "search");
    holder.rateLimitFailure = new TooManyRequestsError("Demasiadas peticiones", 5);

    await renderCatalog("dune");

    expect(searchSpy).not.toHaveBeenCalled();
  });

  it("otra IP no se ve afectada por el aviso de la primera", async () => {
    for (let i = 0; i < 61; i += 1) {
      await renderCatalog("");
    }
    holder.requestHeaders = new Headers({ "x-forwarded-for": "198.51.100.4" });

    expect(await renderCatalog("")).not.toContain('role="alert"');
  });

  it("pasado el minuto la misma IP vuelve a ver resultados", async () => {
    for (let i = 0; i < 61; i += 1) {
      await renderCatalog("");
    }
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));

    expect(await renderCatalog("")).not.toContain('role="alert"');
  });

  it("cualquier otro error se propaga (va a app/error.tsx) y no se disfraza de aviso", async () => {
    holder.rateLimitFailure = new Error("fallo inesperado");

    await expect(renderCatalog("dune")).rejects.toThrow("fallo inesperado");
  });
});
