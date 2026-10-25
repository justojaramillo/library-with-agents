import { ForgotPasswordForm } from "@/features/accounts/ui/forgot-password-form";

/** F16 · Recuperar la contraseña con el correo de Firebase. */
export default function RecuperarPage() {
  return (
    <section aria-labelledby="recuperar-titulo" className="mx-auto w-full max-w-sm space-y-4">
      <h1 id="recuperar-titulo" className="text-2xl font-semibold">
        Recuperar contraseña
      </h1>
      <ForgotPasswordForm />
    </section>
  );
}
