/** Zona horaria con la que se dibuja el HTML inicial; en el navegador se reemplaza por la del usuario. */
export const DEFAULT_TIME_ZONE = "America/Bogota";

const LOCALE = "es-CO";

/** ICU puede usar espacios de no separación (U+00A0, U+202F): se normalizan a un espacio normal. */
function normalizeSpaces(text: string): string {
  return text.replace(/[  ]/g, " ");
}

/** Formateador con la zona pedida; si la zona no existe, cae en la zona por defecto. */
function makeFormatter(options: Intl.DateTimeFormatOptions, timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(LOCALE, { ...options, timeZone });
  } catch {
    return new Intl.DateTimeFormat(LOCALE, { ...options, timeZone: DEFAULT_TIME_ZONE });
  }
}

const DATE_OPTIONS: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" };
const TIME_OPTIONS: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", hour12: true };

function isValidDate(date: Date): boolean {
  return !Number.isNaN(date.getTime());
}

/** «30 de enero de 2026» en la zona dada. Si el texto no es una fecha válida, lo devuelve tal cual. */
export function formatDate(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (!isValidDate(date)) {
    return iso;
  }
  return normalizeSpaces(makeFormatter(DATE_OPTIONS, timeZone).format(date));
}

/** «30 de enero de 2026, 3:45 p. m.» en la zona dada. */
export function formatDateTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (!isValidDate(date)) {
    return iso;
  }
  const day = makeFormatter(DATE_OPTIONS, timeZone).format(date);
  const time = makeFormatter(TIME_OPTIONS, timeZone).format(date);
  return normalizeSpaces(`${day}, ${time}`);
}

/** «$20.000 COP». */
export function formatCop(n: number): string {
  const digits = new Intl.NumberFormat(LOCALE, { useGrouping: "always", maximumFractionDigits: 0 }).format(n);
  return `$${digits} COP`;
}

/** «1 día» / «N días». */
export function formatDaysLate(n: number): string {
  if (n === 1) {
    return "1 día";
  }
  return `${n} días`;
}
