import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ChangePasswordForm } from "@/features/accounts/ui/change-password-form";
import { getContainer } from "@/features/container";
import { getSessionUser } from "@/shared/server/http";

/** Parte dinámica: lee la cookie de sesión y la cuenta, por eso va dentro de `<Suspense>`. */
async function PasswordContent() {
  // Espera la petición real antes de leer la sesión: verificarla usa la hora actual y la precarga de enlaces no debe prerenderizarla (S1, regla 1).
  await connection();
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }
  const member = await getContainer().members.get(user.member_id);
  if (!member) {
    redirect("/login");
  }
  return (
    <>
      <p className="break-words text-ink-muted">Cuenta: {member.email}</p>
      <ChangePasswordForm email={member.email} />
    </>
  );
}

/** F15 · Cambiar mi contraseña (con sesión). */
export default function ChangePasswordPage() {
  return (
    <section aria-labelledby="contrasena-titulo" className="mx-auto w-full max-w-sm space-y-4">
      <h1 id="contrasena-titulo" className="text-2xl font-semibold">
        Cambiar contraseña
      </h1>
      <Suspense fallback={<p role="status">Cargando…</p>}>
        <PasswordContent />
      </Suspense>
    </section>
  );
}
