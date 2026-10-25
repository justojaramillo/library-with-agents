import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * S1 · regla 1: todo componente que lee la sesión (`getSessionUser` / `readNavUser`) espera la petición real con
 * `await connection()` (de `next/server`) antes de leerla; si no, `next dev` da `blocking-prerender-current-time`.
 */
const APP_DIR = join(process.cwd(), "app");

const SESSION_READERS = /\b(getSessionUser|readNavUser)\b/;
const CONNECTION_IMPORT = /import\s*\{[^}]*\bconnection\b[^}]*\}\s*from\s*["']next\/server["']/;
const CONNECTION_CALL = /\bawait\s+connection\s*\(\s*\)/;
const SESSION_CALL = /\bgetSessionUser\s*\(/;

type Source = { path: string; text: string };

/** El código sin comentarios, para que un comentario que mencione `connection(` no cuente. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Archivos `.tsx` de `app/` (a cualquier profundidad). */
function listTsx(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...listTsx(full));
    } else if (entry.name.endsWith(".tsx")) {
      found.push(full);
    }
  }
  return found;
}

/** Motivos por los que un archivo que lee la sesión incumple la regla; vacío si cumple o no lee la sesión. */
function violations(source: Source): string[] {
  const code = stripComments(source.text);
  if (!SESSION_READERS.test(code)) {
    return [];
  }
  const problems: string[] = [];
  if (!CONNECTION_IMPORT.test(code)) {
    problems.push(`${source.path}: no importa connection de next/server`);
  }
  const callAt = code.search(CONNECTION_CALL);
  if (callAt === -1) {
    problems.push(`${source.path}: lee la sesión sin llamar a await connection()`);
    return problems;
  }
  const readAt = code.search(SESSION_CALL);
  if (readAt !== -1 && readAt < callAt) {
    problems.push(`${source.path}: lee la sesión antes de await connection()`);
  }
  return problems;
}

function loadSources(): Source[] {
  return listTsx(APP_DIR).map((file) => ({
    path: relative(process.cwd(), file),
    text: readFileSync(file, "utf8"),
  }));
}

describe("S1 · los componentes que leen la sesión esperan connection()", () => {
  const sources = loadSources();
  const required = [
    "app/session-nav.tsx",
    "app/cuentas/page.tsx",
    "app/prestamos/page.tsx",
    "app/mis-prestamos/page.tsx",
    "app/mis-vencidos/page.tsx",
  ];

  it("ningún .tsx de app/ lee la sesión sin connection()", () => {
    expect(sources.flatMap(violations)).toEqual([]);
  });

  it.each(required)("%s existe, lee la sesión y espera connection() antes", (path) => {
    const source = sources.find((item) => item.path === path);
    expect(source, `falta ${path}`).toBeDefined();
    if (source === undefined) {
      return;
    }
    expect(SESSION_READERS.test(stripComments(source.text))).toBe(true);
    expect(violations(source)).toEqual([]);
  });
});

describe("S1 · el detector de la prueba de proyecto", () => {
  it("detecta un archivo que usa getSessionUser sin connection", () => {
    const source = {
      path: "app/ejemplo/page.tsx",
      text: 'import { getSessionUser } from "@/shared/server/http";\nexport default async function P() {\n  const user = await getSessionUser();\n  return <p>{user?.role}</p>;\n}\n',
    };

    expect(violations(source).length).toBeGreaterThan(0);
  });

  it("detecta un archivo que usa readNavUser sin connection", () => {
    const source = {
      path: "app/ejemplo/nav.tsx",
      text: "export async function Nav() {\n  const user = await readNavUser();\n  return <p>{user?.name}</p>;\n}\n",
    };

    expect(violations(source).length).toBeGreaterThan(0);
  });

  it("detecta connection() en un comentario como si no estuviera", () => {
    const source = {
      path: "app/ejemplo/page.tsx",
      text: "// falta await connection()\nconst user = await getSessionUser();\n",
    };

    expect(violations(source).length).toBeGreaterThan(0);
  });

  it("detecta connection() importado pero llamado después de leer la sesión", () => {
    const source = {
      path: "app/ejemplo/page.tsx",
      text: 'import { connection } from "next/server";\nconst user = await getSessionUser();\nawait connection();\n',
    };

    expect(violations(source).length).toBeGreaterThan(0);
  });

  it("detecta que se llame sin importarlo de next/server", () => {
    const source = {
      path: "app/ejemplo/page.tsx",
      text: "await connection();\nconst user = await getSessionUser();\n",
    };

    expect(violations(source).length).toBeGreaterThan(0);
  });

  it("acepta connection() importado y esperado antes de leer la sesión", () => {
    const source = {
      path: "app/ejemplo/page.tsx",
      text: 'import { connection } from "next/server";\nawait connection();\nconst user = await getSessionUser();\n',
    };

    expect(violations(source)).toEqual([]);
  });

  it("no exige nada a un archivo que no lee la sesión", () => {
    expect(
      violations({ path: "app/ejemplo/page.tsx", text: "export default function P() {\n  return <p>hola</p>;\n}\n" }),
    ).toEqual([]);
  });
});
