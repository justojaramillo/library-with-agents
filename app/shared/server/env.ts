import { z } from "zod";

/**
 * Variables de entorno de Firebase y Vercel Blob (ADR-0003). Los mensajes de esta clase describen QUÉ falla,
 * nunca el valor de la variable: el informe se puede pegar en un chat sin filtrar secretos.
 */
const NonEmpty = z.string().trim().min(1);

export const EnvSchema = z.object({
  FIREBASE_PROJECT_ID: NonEmpty,
  FIREBASE_CLIENT_EMAIL: z.email(),
  FIREBASE_PRIVATE_KEY: NonEmpty,
  NEXT_PUBLIC_FIREBASE_API_KEY: NonEmpty,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: NonEmpty,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: NonEmpty,
  NEXT_PUBLIC_FIREBASE_APP_ID: NonEmpty,
  BLOB_READ_WRITE_TOKEN: z.string().trim().optional(),
  BLOB_STORE_ID: z.string().trim().optional(),
});

export type EnvName = keyof z.infer<typeof EnvSchema>;
export type EnvSource = Record<string, string | undefined>;
export type EnvProblem = { name: string; message: string };

const ISSUE_MESSAGES: Record<string, string> = {
  invalid_type: "FALTA (no está definida)",
  too_small: "VACÍA",
  invalid_format: "FORMATO (no tiene el formato esperado)",
};

const NAMES = Object.keys(EnvSchema.shape);

/**
 * Clave privada tal como la necesita el SDK: sin comillas que la envuelvan (error habitual al pegarla en el panel
 * de Vercel) y con los `\n` literales convertidos en saltos de línea reales.
 */
export function normalizePrivateKey(raw: string): string {
  const trimmed = raw.trim();
  const unquoted = trimmed.replace(/^(["'])([\s\S]*)\1$/, "$2");
  return unquoted.replace(/\\n/g, "\n");
}

export class EnvChecker {
  constructor(private readonly env: EnvSource) {}

  /** Problemas de presencia y formato básico, según el esquema. */
  schemaProblems(): EnvProblem[] {
    const result = EnvSchema.safeParse(this.env);
    if (result.success) {
      return [];
    }
    return result.error.issues.map((issue) => ({
      name: String(issue.path[0]),
      message: ISSUE_MESSAGES[issue.code] ?? "FORMATO",
    }));
  }

  /** Coherencia entre variables y forma de cada una (sin imprimir valores). */
  consistencyProblems(): EnvProblem[] {
    const found: EnvProblem[] = [];
    const get = (name: EnvName) => (this.env[name] ?? "").trim();
    const project = get("FIREBASE_PROJECT_ID");
    const add = (name: EnvName, message: string) => found.push({ name, message });

    if (project && get("NEXT_PUBLIC_FIREBASE_PROJECT_ID") && project !== get("NEXT_PUBLIC_FIREBASE_PROJECT_ID")) {
      add("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "FORMATO (no coincide con FIREBASE_PROJECT_ID)");
    }
    const email = get("FIREBASE_CLIENT_EMAIL");
    if (project && email && !email.endsWith(`@${project}.iam.gserviceaccount.com`)) {
      add("FIREBASE_CLIENT_EMAIL", "FORMATO (no es la cuenta de servicio de este proyecto)");
    }
    const key = normalizePrivateKey(get("FIREBASE_PRIVATE_KEY"));
    if (key && !(key.includes("-----BEGIN PRIVATE KEY-----") && key.includes("-----END PRIVATE KEY-----"))) {
      add("FIREBASE_PRIVATE_KEY", "FORMATO (no parece una clave PEM; revisa las comillas dobles y los \\n)");
    }
    const apiKey = get("NEXT_PUBLIC_FIREBASE_API_KEY");
    if (apiKey && !apiKey.startsWith("AIza")) {
      add("NEXT_PUBLIC_FIREBASE_API_KEY", "FORMATO (una clave web de Firebase empieza por AIza)");
    }
    const appId = get("NEXT_PUBLIC_FIREBASE_APP_ID");
    if (appId && !/^\d+:\d+:web:[0-9a-f]+$/.test(appId)) {
      add("NEXT_PUBLIC_FIREBASE_APP_ID", "FORMATO (debe ser el id de una app WEB: número:número:web:código)");
    }
    const domain = get("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN");
    if (domain && !(domain.endsWith(".firebaseapp.com") || domain.endsWith(".web.app"))) {
      add("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "FORMATO (suele terminar en .firebaseapp.com o .web.app)");
    }
    const blob = get("BLOB_READ_WRITE_TOKEN");
    if (blob && !blob.startsWith("vercel_blob_rw_")) {
      add("BLOB_READ_WRITE_TOKEN", "FORMATO (un token de Blob empieza por vercel_blob_rw_)");
    }
    return found;
  }

  /** Todos los problemas, sin repetir variables. */
  problems(): EnvProblem[] {
    const byName = new Map<string, EnvProblem>();
    for (const problem of [...this.schemaProblems(), ...this.consistencyProblems()]) {
      if (!byName.has(problem.name)) {
        byName.set(problem.name, problem);
      }
    }
    return [...byName.values()];
  }

  /** Informe de una línea por variable: solo estado, nunca valores. */
  report(): string {
    const problems = new Map(this.problems().map((problem) => [problem.name, problem.message]));
    const lines = NAMES.map((name) => {
      const message = problems.get(name);
      if (message) {
        return `  ✗ ${name}: ${message}`;
      }
      if (name === "BLOB_READ_WRITE_TOKEN" && !(this.env[name] ?? "").trim()) {
        return `  · ${name}: pendiente (se crea al configurar Vercel Blob)`;
      }
      if (name === "BLOB_STORE_ID" && !(this.env[name] ?? "").trim()) {
        return `  · ${name}: pendiente (opcional; id del store de Vercel Blob)`;
      }
      return `  ✓ ${name}`;
    });
    return lines.join("\n");
  }

  isValid(): boolean {
    return this.problems().length === 0;
  }
}
