import { type FirebaseApp, getApp, getApps, initializeApp } from "firebase/app";
import { type Auth, getAuth } from "firebase/auth";

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

/** Autenticación de Firebase en el navegador: solo sirve para ingresar; la sesión real es la cookie del servidor. */
export function getClientAuth(): Auth {
  return getAuth(getClientApp());
}
