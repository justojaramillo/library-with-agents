interface AvailabilityProps {
  available: number;
  copies: number;
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="10" cy="10" r="8" />
      <path d="M6 10.5l2.5 2.5L14 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="10" cy="10" r="8" />
      <path d="M7 7l6 6M13 7l-6 6" strokeLinecap="round" />
    </svg>
  );
}

/** Disponibilidad de un libro: icono decorativo + palabra, nunca solo color (WCAG 1.4.1). */
export function Availability({ available, copies }: AvailabilityProps) {
  if (available > 0) {
    return (
      <p className="flex items-start gap-2 font-medium text-success">
        <CheckIcon />
        <strong>
          Disponible: {available} de {copies} ejemplares
        </strong>
      </p>
    );
  }
  return (
    <p className="flex items-start gap-2 font-medium text-danger">
      <CrossIcon />
      <strong>Agotado: 0 de {copies} ejemplares</strong>
    </p>
  );
}
