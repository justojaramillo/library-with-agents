import type { TeacherRequestItem } from "@/features/accounts/schema";

/** Elemento del listado de solicitudes (F37) con valores válidos; se sobreescribe lo que importa a cada prueba. */
export function anItem(over: Partial<TeacherRequestItem> = {}): TeacherRequestItem {
  return {
    member_id: "uid-ana",
    member_name: "Ana Pérez",
    member_email: "ana@example.com",
    member_role: "EXTERNO",
    email_verified: true,
    note: "Docente de Ingeniería, Universidad Nacional",
    status: "PENDIENTE",
    requested_at: "2026-01-05T15:00:00.000Z",
    decided_at: null,
    decided_by: null,
    reason: null,
    ...over,
  };
}

/** Solicitud ya resuelta: fecha y quien decidió rellenados. */
export function aDecidedItem(
  status: "APROBADA" | "RECHAZADA",
  over: Partial<TeacherRequestItem> = {},
): TeacherRequestItem {
  return anItem({
    status,
    decided_at: "2026-01-30T15:00:00.000Z",
    decided_by: "uid-staff",
    ...over,
  });
}
