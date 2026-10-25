import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getContainer } from "@/features/container";
import { TeacherRequestPanel } from "@/features/accounts/ui/teacher-request-panel";
import { describeTeacherRequestState } from "@/features/accounts/ui/teacher-request-state";
import type { MyTeacherRequest } from "@/features/accounts/schema";
import { STAFF_ROLES, type Role, type SessionUser } from "@/shared/schema";
import { getSessionUser } from "@/shared/server/http";

const NO_REQUEST: MyTeacherRequest = { request: null, email_verified: false };

/** Solo para decidir qué leer; el servidor valida de verdad. */
function isStaff(role: Role): boolean {
  return (STAFF_ROLES as readonly Role[]).includes(role);
}

/** La solicitud propia; el personal no tiene (y no se consulta). */
async function readMine(user: SessionUser): Promise<MyTeacherRequest> {
  if (isStaff(user.role)) {
    return NO_REQUEST;
  }
  return getContainer().teacherRequests.getMine(user);
}

/** El correo solo se necesita para reenviar la verificación; se lee de la cuenta, no del cliente. */
async function readEmail(user: SessionUser): Promise<string> {
  const member = await getContainer().members.get(user.member_id);
  if (!member) {
    return "";
  }
  return member.email;
}

/** Parte dinámica: lee la cookie de sesión, por eso va dentro de `<Suspense>`. */
async function TeacherContent() {
  // Espera la petición real antes de leer la sesión: verificarla usa la hora actual y la precarga de enlaces no debe prerenderizarla (S1, regla 1).
  await connection();
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }
  const mine = await readMine(user);
  const view = describeTeacherRequestState(user.role, mine, new Date());
  let email = "";
  if (view.kind === "verify_email") {
    email = await readEmail(user);
  }
  return <TeacherRequestPanel view={view} email={email} />;
}

/** F11 · Solicitar el rol de docente y ver cómo va la solicitud. */
export default function TeacherPage() {
  return (
    <section aria-labelledby="docente-titulo" className="space-y-4">
      <h1 id="docente-titulo" className="text-2xl font-semibold">
        Solicitar el rol de docente
      </h1>
      <Suspense fallback={<p role="status">Cargando tu solicitud…</p>}>
        <TeacherContent />
      </Suspense>
    </section>
  );
}
