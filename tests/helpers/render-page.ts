import type { ReactElement } from "react";
import { prerender } from "react-dom/static";

/**
 * HTML completo de un componente de servidor asíncrono: espera a que todo `<Suspense>` termine
 * (sin la parte de «cargando»). Los errores dentro del `<Suspense>` no lanzan: la pantalla queda vacía.
 */
export async function renderComplete(element: ReactElement): Promise<string> {
  const { prelude } = await prerender(element, { onError: () => undefined });
  return new Response(prelude).text();
}
