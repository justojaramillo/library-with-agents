import type { Role } from "@/shared/schema";

/** Etiqueta legible en español de cada rol. Solo para mostrar; los permisos los decide el servidor. */
export const ROLE_LABELS: Record<Role, string> = {
  EXTERNO: "Externo/a",
  ESTUDIANTE: "Estudiante",
  DOCENTE: "Docente",
  BIBLIOTECARIO: "Bibliotecario/a",
  ADMINISTRADOR: "Administrador/a",
};
