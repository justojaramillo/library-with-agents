import { LoginForm } from "@/features/accounts/ui/login-form";

/** F4 · Ingreso con correo y contraseña. */
export default function LoginPage() {
  return (
    <section aria-labelledby="login-titulo" className="mx-auto w-full max-w-sm space-y-4">
      <h1 id="login-titulo" className="text-2xl font-semibold">
        Ingresar
      </h1>
      <LoginForm />
    </section>
  );
}
