import { RegisterForm } from "@/features/accounts/ui/register-form";

/** F10 · Autorregistro de una cuenta de externo o estudiante. */
export default function RegistroPage() {
  return (
    <section aria-labelledby="registro-titulo" className="mx-auto w-full max-w-sm space-y-4">
      <h1 id="registro-titulo" className="text-2xl font-semibold">
        Crear cuenta
      </h1>
      <RegisterForm />
    </section>
  );
}
