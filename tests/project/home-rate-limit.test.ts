import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * S1 regla 12 / ADR-0008: la página `/?q=` cuenta la búsqueda en el límite de tasa y espera la conexión real antes
 * de leer Firestore. Es una comprobación de texto para que no se pierda sin darse cuenta; el comportamiento se
 * prueba en `app/features/catalog/tests/home-rate-limit.test.ts`.
 */
const page = readFileSync(join(process.cwd(), "app", "page.tsx"), "utf8");
const code = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("S1 · app/page.tsx conserva el límite de tasa y connection()", () => {
  it("llama a enforceRateLimit con el cubo catalogSearch", () => {
    expect(code).toMatch(/\benforceRateLimit\s*\(\s*"catalogSearch"/);
  });

  it("usa clientKey con las cabeceras de la petición", () => {
    expect(code).toMatch(/\bclientKey\s*\(/);
  });

  it("espera await connection() de next/server", () => {
    expect(code).toMatch(/import\s*\{[^}]*\bconnection\b[^}]*\}\s*from\s*["']next\/server["']/);
    expect(code).toMatch(/\bawait\s+connection\s*\(/);
  });

  it("espera la conexión antes de leer el catálogo", () => {
    const connectionAt = code.search(/\bawait\s+connection\s*\(/);
    const searchAt = code.search(/\.search\s*\(/);

    expect(connectionAt).toBeGreaterThan(-1);
    expect(searchAt).toBeGreaterThan(-1);
    expect(connectionAt).toBeLessThan(searchAt);
  });
});
