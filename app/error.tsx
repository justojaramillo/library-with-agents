"use client";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Pantalla de error de lectura (regla 16): mensaje en español y botón para reintentar. */
export default function ErrorPage({ reset }: ErrorPageProps) {
  return (
    <section aria-labelledby="error-titulo" className="space-y-4">
      <h1 id="error-titulo" className="text-2xl font-semibold">
        Algo salió mal
      </h1>
      <p role="alert" className="font-medium text-danger">
        No se pudo cargar la información. Inténtalo de nuevo en unos instantes.
      </p>
      <button
        type="button"
        onClick={reset}
        className="min-h-11 rounded bg-primary px-4 font-medium text-surface hover:bg-primary-hover"
      >
        Reintentar
      </button>
    </section>
  );
}
