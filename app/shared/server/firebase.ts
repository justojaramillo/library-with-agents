import "server-only";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { EnvChecker, EnvSchema } from "./env";

export { COLLECTIONS } from "./collections";

/** Solo las tres variables de la cuenta de servicio; los mensajes de Zod no incluyen los valores. */
const CredentialsSchema = EnvSchema.pick({
  FIREBASE_PROJECT_ID: true,
  FIREBASE_CLIENT_EMAIL: true,
  FIREBASE_PRIVATE_KEY: true,
});

/**
 * App de administración: se inicializa una sola vez (perezosa). `getApps()` evita duplicarla cuando el módulo
 * se vuelve a evaluar por la recarga en caliente de desarrollo.
 */
function getAdminApp(): App {
  const existing = getApps().at(0);
  if (existing) {
    return existing;
  }
  const parsed = CredentialsSchema.safeParse(process.env);
  if (!parsed.success) {
    // Nunca se propaga el ZodError (podría revelar nombres de variables): solo el estado de cada una.
    console.error(new EnvChecker(process.env).report());
    throw new Error("Configuración de Firebase incompleta");
  }
  const env = parsed.data;
  return initializeApp({
    credential: cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      // En el archivo de entorno la clave lleva `\n` literales: se vuelven saltos de línea reales.
      privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

/** Firebase Authentication (administración). */
export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

/** Firestore (administración). Las reglas de seguridad niegan el acceso directo del cliente. */
export function getAdminDb(): Firestore {
  return getFirestore(getAdminApp());
}
