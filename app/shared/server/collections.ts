/**
 * Nombres de las colecciones de Firestore (ADR-0003). Viven aparte de `firebase.ts` (que lleva `server-only`)
 * para que los repositorios y sus pruebas con el emulador puedan importarlos sin cargar el SDK de administración.
 */
export const COLLECTIONS = {
  members: "members",
  books: "books",
  loans: "loans",
  teacherRequests: "teacher_requests",
  meta: "meta",
} as const;
