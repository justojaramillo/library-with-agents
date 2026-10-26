import { isIP } from "node:net";
import { TooManyRequestsError } from "../errors";

/** Límites por cubo (ADR-0008): ventana fija, `limit` peticiones por `windowMs`. */
export const RATE_LIMITS = {
  catalogSearch: { limit: 60, windowMs: 60_000 },
  memberSearch: { limit: 30, windowMs: 60_000 },
  register: { limit: 10, windowMs: 3_600_000 },
  login: { limit: 30, windowMs: 60_000 },
  teacherRequest: { limit: 5, windowMs: 3_600_000 },
  contentUpload: { limit: 20, windowMs: 3_600_000 },
};

type Window = { count: number; resetAt: number };

/** Contadores del proceso: la clave es `cubo|clave`. El límite es por instancia (ADR-0008). */
const windows = new Map<string, Window>();

/** Clave que se devuelve cuando no hay una IP válida; no se limita (no hay un cubo compartido para anónimos). */
const UNKNOWN_KEY = "desconocida";

/** Tope de entradas del Map (S1, regla 12). */
const MAX_ENTRIES = 10_000;

/** Longitud máxima de una IP aceptada como clave. */
const MAX_KEY_LENGTH = 64;

/**
 * El barrido de vencidas ocurre como máximo una vez por ventana (la menor de los cubos). Es seguro con ventanas
 * largas: el barrido solo borra entradas cuyo `resetAt` ya pasó, así que una clave de `register` vive su hora completa.
 */
const SWEEP_INTERVAL_MS = Math.min(...Object.values(RATE_LIMITS).map((rule) => rule.windowMs));

/** Instante (ms) del último barrido de vencidas. */
let lastSweepMs = 0;

function sweepExpired(nowMs: number): void {
  lastSweepMs = nowMs;
  for (const [mapKey, window] of windows) {
    if (window.resetAt <= nowMs) {
      windows.delete(mapKey);
    }
  }
}

/** Hace sitio para una entrada nueva: barre las vencidas (como mucho una vez por ventana) y, si sigue lleno, expulsa la más antigua. */
function makeRoom(nowMs: number): void {
  if (windows.size < MAX_ENTRIES) {
    return;
  }
  if (nowMs - lastSweepMs >= SWEEP_INTERVAL_MS) {
    sweepExpired(nowMs);
  }
  while (windows.size >= MAX_ENTRIES) {
    const oldest = windows.keys().next();
    if (oldest.done === true) {
      return;
    }
    windows.delete(oldest.value);
  }
}

/**
 * Cuenta una petición del cubo para la clave. La petición número `limit` pasa y la `limit + 1` lanza
 * `TooManyRequestsError` con los segundos que faltan para que cierre la ventana.
 * La clave `"desconocida"` no se limita: retorna sin contar.
 */
export function enforceRateLimit(bucket: keyof typeof RATE_LIMITS, key: string, now: Date): void {
  if (key === UNKNOWN_KEY) {
    return;
  }
  const { limit, windowMs } = RATE_LIMITS[bucket];
  const nowMs = now.getTime();
  const mapKey = `${bucket}|${key}`;
  const current = windows.get(mapKey);
  if (current === undefined || current.resetAt <= nowMs) {
    windows.delete(mapKey);
    makeRoom(nowMs);
    windows.set(mapKey, { count: 1, resetAt: nowMs + windowMs });
    return;
  }
  if (current.count >= limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - nowMs) / 1000));
    throw new TooManyRequestsError("Demasiadas peticiones; inténtalo más tarde", retryAfterSeconds);
  }
  current.count += 1;
}

/** Los primeros `count` grupos de 16 bits de una IPv6 (ya validada), con `::` y un IPv4 final expandidos. */
function ipv6Groups(address: string): number[] {
  let text = address.toLowerCase();
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const octets = tail.split(".").map((part) => Number.parseInt(part, 10));
    const high = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0);
    const low = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0);
    text = `${text.slice(0, lastColon + 1)}${high.toString(16)}:${low.toString(16)}`;
  }
  const halves = text.split("::");
  const head = (halves[0] ?? "").split(":").filter((part) => part !== "");
  const rest = (halves[1] ?? "").split(":").filter((part) => part !== "");
  const missing = 8 - head.length - rest.length;
  const zeros = new Array<string>(Math.max(0, missing)).fill("0");
  const all = [...head, ...zeros, ...rest];
  return all.map((part) => Number.parseInt(part, 16));
}

/** IPv4 contenida en una IPv6 «mapeada» (`::ffff:a.b.c.d` o `::ffff:xxxx:xxxx`), o `null` si no lo es. */
function mappedIpv4(groups: number[]): string | null {
  const isMapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (!isMapped) {
    return null;
  }
  const high = groups[6] ?? 0;
  const low = groups[7] ?? 0;
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

/** Clave canónica de una IP válida: IPv4 tal cual; IPv6 reducida a su prefijo /64 (`a:b:c:d::/64`). */
function canonicalKey(address: string, version: number): string {
  if (version === 4) {
    return address;
  }
  const withoutZone = address.split("%")[0] ?? address;
  const groups = ipv6Groups(withoutZone);
  const mapped = mappedIpv4(groups);
  if (mapped !== null) {
    return mapped;
  }
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}

/** Primer valor de una cabecera de lista separada por comas, recortado (sin partir cabeceras enormes). */
function firstValue(header: string): string {
  const comma = header.indexOf(",");
  if (comma === -1) {
    return header.trim();
  }
  return header.slice(0, comma).trim();
}

/**
 * IP del cliente: `x-vercel-forwarded-for` y, si falta, la primera de `x-forwarded-for`. Debe ser una IP válida
 * de máximo 64 caracteres; las IPv6 se reducen a su prefijo /64. Si no hay IP válida, `"desconocida"` (no se limita).
 */
export function clientKey(source: { headers: Pick<Headers, "get"> }): string {
  const header = source.headers.get("x-vercel-forwarded-for") ?? source.headers.get("x-forwarded-for");
  if (header === null) {
    return UNKNOWN_KEY;
  }
  const candidate = firstValue(header);
  if (candidate === "" || candidate.length > MAX_KEY_LENGTH) {
    return UNKNOWN_KEY;
  }
  const version = isIP(candidate);
  if (version === 0) {
    return UNKNOWN_KEY;
  }
  return canonicalKey(candidate, version);
}

/** Solo para pruebas: vacía todos los contadores. */
export function resetRateLimits(): void {
  windows.clear();
  lastSweepMs = 0;
}
