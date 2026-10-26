import { inspect } from "node:util";
import type { MockInstance } from "vitest";
import { vi } from "vitest";
import { createDigitalService } from "@/features/reader/server/digital-service";
import {
  createFakeActiveDigitalLoans,
  createMemoryContentStore,
  createMemoryDigitalBookRepository,
} from "@/features/reader/server/repository.memory";
import type { Role, SessionUser } from "@/shared/schema";

/** Mundo de F27: almacén, repositorio y contador de préstamos digitales en memoria, con el servicio real. */
export function makeDigitalWorld() {
  const store = createMemoryContentStore();
  const books = createMemoryDigitalBookRepository();
  const activeLoans = createFakeActiveDigitalLoans();
  const service = createDigitalService({ books, store, activeLoans });
  return { store, books, activeLoans, service };
}
export type DigitalWorld = ReturnType<typeof makeDigitalWorld>;

/** Instante fijo de las pruebas (el tiempo se inyecta). */
export const NOW = new Date("2026-03-05T12:30:00.000Z");

export function actorOf(role: Role, memberId = "staff-1"): SessionUser {
  return { member_id: memberId, role };
}

/** Texto de exactamente `bytes` bytes en UTF-8 (solo la letra «a»). */
export function asciiOfBytes(bytes: number): string {
  return "a".repeat(bytes);
}

/** Espía todas las salidas de consola y devuelve una función que junta lo escrito en un solo texto. */
export function captureConsole(): () => string {
  const spies: MockInstance[] = [
    vi.spyOn(console, "log").mockImplementation(() => undefined),
    vi.spyOn(console, "info").mockImplementation(() => undefined),
    vi.spyOn(console, "warn").mockImplementation(() => undefined),
    vi.spyOn(console, "error").mockImplementation(() => undefined),
    vi.spyOn(console, "debug").mockImplementation(() => undefined),
  ];
  return () =>
    spies
      .flatMap((spy) => spy.mock.calls)
      .map((call) => call.map((arg) => inspect(arg, { depth: 6 })).join(" "))
      .join("\n");
}

/** Tamaño real en bytes UTF-8, calculado con el estándar del navegador. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
