import { TeacherRequestForm } from "./teacher-request-form";
import { VERIFY_HEADING, type TeacherRequestView } from "./teacher-request-state";
import { VerifyEmailForm } from "./verify-email-form";

function Detail({ text }: { text: string | null }) {
  if (text === null) {
    return null;
  }
  return <p>{text}</p>;
}

function VerifyEmailNotice({ text, email }: { text: string; email: string }) {
  return (
    <section aria-labelledby="verificar-titulo" className="space-y-4">
      <h2 id="verificar-titulo" className="text-xl font-semibold">
        {VERIFY_HEADING}
      </h2>
      <p>{text}</p>
      <VerifyEmailForm email={email} />
    </section>
  );
}

/** F11 · Contenido de `/docente` según el estado; los datos llegan por props (`email` solo se usa para reenviar la verificación). */
export function TeacherRequestPanel({ view, email }: { view: TeacherRequestView; email: string }) {
  if (view.kind === "form") {
    return <TeacherRequestForm />;
  }
  if (view.kind === "verify_email") {
    return <VerifyEmailNotice text={view.text} email={email} />;
  }
  if (view.kind === "staff") {
    return (
      <p role="alert" className="font-medium text-danger">
        {view.text}
      </p>
    );
  }
  return (
    <article className="space-y-2">
      <p className="text-lg font-medium">{view.text}</p>
      <Detail text={view.detail} />
    </article>
  );
}
