import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Enmienda de F10·F16·F17: el navegador no debe compilar código con Zod (la CSP lo bloquea). Para eso
 * `@/shared/ui/client-setup` fija `jitless` ANTES de que se evalúe cualquier módulo que cree esquemas.
 * Los imports de ES se evalúan en orden, así que ese módulo (o `./auth-client`, que lo importa primero)
 * debe ser el primer import de todo archivo del navegador que traiga esquemas.
 */
const APP_DIR = join(process.cwd(), "app");
const CLIENT_SETUP = "@/shared/ui/client-setup";
const SETUP_MODULE_PATH = "app/shared/ui/client-setup.tsx";

type Source = { path: string; text: string };
type Import = { specifier: string; typeOnly: boolean };

/** El código sin comentarios, para que un comentario que parezca un import no cuente. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Imports estáticos en orden de aparición (incluye los de solo efecto, `import "x"`). */
function readImports(text: string): Import[] {
  const code = stripComments(text);
  const found: Import[] = [];
  for (const match of code.matchAll(/^[ \t]*import\s+(type\s+)?(?:[^;]*?\bfrom\s+)?["']([^"']+)["']/gm)) {
    found.push({ specifier: match[2], typeOnly: match[1] !== undefined });
  }
  return found;
}

/** `true` si el archivo declara `"use client"` como primera sentencia. */
function isClientModule(text: string): boolean {
  return /^\s*["']use client["']/.test(stripComments(text));
}

/** Imports que traen Zod o esquemas: `zod`, `@/shared/schema`, cualquier ruta que termine en `schema` o `./auth-client`. */
function bringsSchemas(specifier: string): boolean {
  return (
    specifier === "zod" ||
    specifier.startsWith("zod/") ||
    specifier === "@/shared/schema" ||
    /(^|\/)schema$/.test(specifier) ||
    /(^|\/)auth-client$/.test(specifier)
  );
}

/** Primer import válido: `client-setup` o `./auth-client` (que a su vez importa `client-setup` primero). */
function isSetupImport(specifier: string): boolean {
  return specifier === CLIENT_SETUP || specifier === "./auth-client";
}

function isFeatureUiModule(path: string): boolean {
  return /^app\/features\/[^/]+\/ui\//.test(path);
}

/** Ruta (relativa a la raíz) del archivo que resuelve un import del proyecto, o `null` si es un paquete o no existe. */
function resolveProjectImport(fromPath: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = join("app", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = join(dirname(fromPath), specifier);
  } else {
    return null;
  }
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(join(process.cwd(), candidate))) {
      return candidate;
    }
  }
  return null;
}

/**
 * Archivos que acaban en el navegador: los de cliente y todo lo que importan (sin contar `import type`).
 * Un módulo de `ui/` que solo usa el servidor (p. ej. la barra de navegación) no los necesita.
 */
function browserReachable(sources: Source[]): Set<string> {
  const byPath = new Map(sources.map((source) => [source.path, source]));
  const reached = new Set<string>();
  const pending = sources.filter((source) => isClientModule(source.text)).map((source) => source.path);
  while (pending.length > 0) {
    const path = pending.pop();
    if (path === undefined || reached.has(path)) {
      continue;
    }
    reached.add(path);
    for (const entry of readImports(byPath.get(path)?.text ?? "")) {
      const target = resolveProjectImport(path, entry.specifier);
      if (!entry.typeOnly && target !== null) {
        pending.push(target);
      }
    }
  }
  return reached;
}

/** `true` si es un paquete de terceros distinto de Zod (`react`, `next/link`, `firebase/auth`…). */
function isHarmlessPackage(specifier: string): boolean {
  const isProjectPath = specifier.startsWith(".") || specifier.startsWith("@/");
  const isZod = specifier === "zod" || specifier.startsWith("zod/");
  return !isProjectPath && !isZod;
}

/**
 * Motivos por los que un archivo incumple la regla (vacío si cumple o no aplica).
 * Los `import type` se borran al compilar y no ejecutan nada: no cuentan. Antes del import de arranque
 * solo se admiten paquetes de terceros que no son Zod (no crean esquemas); cualquier import del proyecto
 * o de Zod que lo preceda podría evaluar un esquema antes de fijar `jitless`.
 */
function violations(path: string, text: string, inBrowser: boolean = false): string[] {
  if (path === SETUP_MODULE_PATH) {
    return [];
  }
  const applies = isClientModule(text) || (isFeatureUiModule(path) && inBrowser);
  if (!applies) {
    return [];
  }
  const imports = readImports(text).filter((entry) => !entry.typeOnly);
  if (!imports.some((entry) => bringsSchemas(entry.specifier))) {
    return [];
  }
  for (const entry of imports) {
    if (isSetupImport(entry.specifier)) {
      return [];
    }
    if (!isHarmlessPackage(entry.specifier)) {
      return [`${path}: «${entry.specifier}» se importa antes que client-setup y puede crear esquemas`];
    }
  }
  return [`${path}: trae Zod o esquemas pero no importa client-setup`];
}

/** Archivos `.ts`/`.tsx` de `app/` que no son pruebas. */
function listSources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "tests") {
        found.push(...listSources(full));
      }
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

function load(path: string): Source {
  return { path, text: readFileSync(join(process.cwd(), path), "utf8") };
}

const SOURCES = listSources(APP_DIR).map((file) => load(relative(process.cwd(), file)));
const IN_BROWSER = browserReachable(SOURCES);

function realViolations(): string[] {
  return SOURCES.flatMap((source) => violations(source.path, source.text, IN_BROWSER.has(source.path)));
}

describe("Orden de importación: client-setup antes que Zod y los esquemas en el navegador", () => {
  it("revisa archivos de cliente (la prueba no es vacía)", () => {
    const clients = SOURCES.filter((source) => isClientModule(source.text));
    expect(clients.length).toBeGreaterThan(3);
  });

  it("todo archivo de cliente o de ui con esquemas importa primero client-setup", () => {
    expect(realViolations()).toEqual([]);
  });

  it("hay al menos un módulo no-cliente de ui con esquemas sujeto a la regla (api-client de préstamos)", () => {
    expect(IN_BROWSER.has("app/features/loans/ui/api-client.ts")).toBe(true);
    const apiClient = SOURCES.find((source) => source.path === "app/features/loans/ui/api-client.ts");
    expect(apiClient).toBeDefined();
    expect(isClientModule(apiClient?.text ?? "")).toBe(false);
    const imports = readImports(apiClient?.text ?? "").filter((entry) => !entry.typeOnly);
    expect(imports.some((entry) => bringsSchemas(entry.specifier))).toBe(true);
  });
});

describe("Orden de importación · los dos módulos de arranque", () => {
  const authClient = SOURCES.find((source) => source.path === "app/features/accounts/ui/auth-client.ts");
  const clientSetup = SOURCES.find((source) => source.path === "app/shared/ui/client-setup.tsx");

  it("auth-client.ts importa client-setup antes que cualquier import del proyecto o de Zod", () => {
    expect(authClient).toBeDefined();
    const imports = readImports(authClient?.text ?? "");
    const setupAt = imports.findIndex((entry) => entry.specifier === CLIENT_SETUP);
    expect(setupAt).toBeGreaterThanOrEqual(0);
    for (const entry of imports.slice(0, setupAt)) {
      expect(isHarmlessPackage(entry.specifier)).toBe(true);
    }
  });

  it("auth-client.ts importa client-setup antes que el contrato", () => {
    const specifiers = readImports(authClient?.text ?? "").map((entry) => entry.specifier);
    const setupAt = specifiers.indexOf(CLIENT_SETUP);
    expect(setupAt).toBeGreaterThanOrEqual(0);
    for (const [index, specifier] of specifiers.entries()) {
      if (bringsSchemas(specifier)) {
        expect(index).toBeGreaterThan(setupAt);
      }
    }
  });

  it("client-setup.tsx es de cliente y no importa esquemas del proyecto (solo zod)", () => {
    expect(clientSetup).toBeDefined();
    expect(isClientModule(clientSetup?.text ?? "")).toBe(true);
    const specifiers = readImports(clientSetup?.text ?? "").map((entry) => entry.specifier);
    expect(specifiers).toContain("zod");
    for (const specifier of specifiers) {
      expect(specifier === "zod" || !bringsSchemas(specifier)).toBe(true);
    }
  });
});

describe("Orden de importación · la propia regla detecta incumplimientos", () => {
  const CLIENT_SOURCE = '"use client";\n';

  it("detecta un componente de cliente que importa Zod antes que client-setup", () => {
    const text = `${CLIENT_SOURCE}import { z } from "zod";\nimport "@/shared/ui/client-setup";\n`;
    expect(violations("app/x/form.tsx", text)).toHaveLength(1);
  });

  it("detecta un componente de cliente que importa el contrato compartido sin client-setup", () => {
    const text = `${CLIENT_SOURCE}import { ApiErrorSchema } from "@/shared/schema";\n`;
    expect(violations("app/x/form.tsx", text)).toHaveLength(1);
  });

  it("detecta un esquema de feature (../schema) importado antes que client-setup", () => {
    const text = `${CLIENT_SOURCE}import { LoanSchema } from "../schema";\nimport "@/shared/ui/client-setup";\n`;
    expect(violations("app/features/loans/ui/form.tsx", text)).toHaveLength(1);
  });

  it("detecta un módulo no-cliente de ui que importa esquemas sin client-setup", () => {
    const text = 'import { LoanSchema } from "../schema";\n';
    expect(violations("app/features/loans/ui/api-client.ts", text, true)).toHaveLength(1);
  });

  it("detecta que un import del proyecto precede a client-setup (podría traer esquemas)", () => {
    const text = `${CLIENT_SOURCE}import { getClientAuth } from "@/shared/ui/firebase-client";\nimport "@/shared/ui/client-setup";\nimport { z } from "zod";\n`;
    expect(violations("app/x/form.tsx", text)).toHaveLength(1);
  });

  it("detecta un archivo con esquemas que nunca importa client-setup aunque tenga otros imports", () => {
    const text = `${CLIENT_SOURCE}import { useState } from "react";\nimport { z } from "zod";\n`;
    expect(violations("app/x/form.tsx", text)).toHaveLength(1);
  });

  it("acepta paquetes de terceros que no son Zod antes de client-setup (no crean esquemas)", () => {
    const text = `${CLIENT_SOURCE}import Link from "next/link";\nimport { signOut } from "firebase/auth";\nimport "@/shared/ui/client-setup";\nimport { z } from "zod";\n`;
    expect(violations("app/x/form.tsx", text)).toEqual([]);
  });

  it("acepta client-setup como primer import", () => {
    const text = `${CLIENT_SOURCE}import "@/shared/ui/client-setup";\nimport { z } from "zod";\n`;
    expect(violations("app/x/form.tsx", text)).toEqual([]);
  });

  it("acepta ./auth-client como primer import", () => {
    const text = `${CLIENT_SOURCE}import { signInAndGetIdToken } from "./auth-client";\nimport { z } from "zod";\n`;
    expect(violations("app/features/accounts/ui/form.tsx", text)).toEqual([]);
  });

  it("detecta ./auth-client si lo precede un import del proyecto", () => {
    const text = `${CLIENT_SOURCE}import { x } from "./otro";\nimport { signInAndGetIdToken } from "./auth-client";\n`;
    expect(violations("app/features/accounts/ui/form.tsx", text)).toHaveLength(1);
  });

  it("no exige client-setup a un módulo de ui con esquemas que solo usa el servidor", () => {
    const text = 'import { ROLES } from "@/shared/schema";\n';
    expect(violations("app/features/accounts/ui/nav-bar.tsx", text, false)).toEqual([]);
  });

  it("ignora los comentarios, también si parecen imports", () => {
    const text = `${CLIENT_SOURCE}// import { z } from "zod";\n/* import "x"; */\nimport "@/shared/ui/client-setup";\nimport { z } from "zod";\n`;
    expect(violations("app/x/form.tsx", text)).toEqual([]);
  });

  it("no exige nada a un archivo de cliente sin esquemas ni a uno de servidor fuera de ui", () => {
    expect(violations("app/x/button.tsx", `${CLIENT_SOURCE}import { useState } from "react";\n`)).toEqual([]);
    expect(violations("app/x/server.ts", 'import { z } from "zod";\n')).toEqual([]);
  });

  it("los imports de solo tipos no cuentan (no se ejecutan)", () => {
    const text = `${CLIENT_SOURCE}import type { Member } from "@/shared/schema";\nimport { useState } from "react";\n`;
    expect(violations("app/x/form.tsx", text)).toEqual([]);
  });
});

describe("Pantallas públicas nuevas · rutas sin sesión (regla 18)", () => {
  for (const route of ["app/registro/page.tsx", "app/recuperar/page.tsx"]) {
    it(`${route} existe y no lee la sesión, por lo que no necesita connection()`, () => {
      const source = SOURCES.find((entry) => entry.path === route);
      expect(source).toBeDefined();
      const code = stripComments(source?.text ?? "");
      expect(code).not.toMatch(/\b(getSessionUser|readNavUser)\b/);
      expect(code).not.toMatch(/\b(cookies|headers)\s*\(/);
    });
  }
});
