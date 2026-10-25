import { type FirebaseApp, getApp, getApps, initializeApp } from "firebase/app";
import { type Auth, getAuth, inMemoryPersistence, initializeAuth } from "firebase/auth";

/** Configuración pública de la app web (no son secretos). Next solo sustituye estas lecturas literales. */
function readFirebaseConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
}

/** Inicializa la app web una sola vez y reutiliza la existente en las llamadas siguientes. */
function getClientApp(): FirebaseApp {
  if (getApps().length > 0) {
    return getApp();
  }
  return initializeApp(readFirebaseConfig());
}

/** `true` si el error del SDK es `auth/already-initialized` (se comprueba por su `code`). */
function isAlreadyInitialized<T>(error: T): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  return "code" in error && error.code === "auth/already-initialized";
}

/**
 * Autenticación de Firebase en el navegador: solo sirve para obtener el `id_token`; la sesión real es la cookie del servidor.
 * Se usa `initializeAuth` con persistencia en memoria y sin resolutor de ventanas emergentes (S1, regla 18), así el SDK no
 * carga `apis.google.com` ni el iframe `__/auth`, que la CSP bloquea. `initializeAuth` lanza si ya se llamó para la misma
 * app (recarga en caliente, renderizado repetido): en ese caso (`auth/already-initialized`) se reutiliza la instancia existente con `getAuth`; cualquier otro error se relanza.
 */
export function getClientAuth(): Auth {
  const app = getClientApp();
  try {
    return initializeAuth(app, { persistence: inMemoryPersistence });
  } catch (error) {
    if (isAlreadyInitialized(error)) {
      return getAuth(app);
    }
    throw error;
  }
}
