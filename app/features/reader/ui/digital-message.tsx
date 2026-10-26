import Link from "next/link";
import { DIGITAL_SESSION_ENDED_ERROR } from "./digital-state";

/** Resultado del último intento de un formulario: nada, hecho (con su aviso) o error (con su mensaje). */
export type DigitalOutcome = { kind: "idle" } | { kind: "done"; text: string } | { kind: "error"; message: string };

export const IDLE_OUTCOME: DigitalOutcome = { kind: "idle" };

/** El id que enlaza el formulario con su error; `undefined` si no hay error. */
export function errorDescribedBy(outcome: DigitalOutcome, id: string): string | undefined {
  if (outcome.kind === "error") {
    return id;
  }
  return undefined;
}

/** Une los ids que describen un campo, sin los que no existen; `undefined` si no queda ninguno. */
export function joinDescribedBy(ids: (string | undefined)[]): string | undefined {
  const present = ids.filter((id) => id !== undefined);
  if (present.length === 0) {
    return undefined;
  }
  return present.join(" ");
}

/** Con la sesión terminada el mensaje lleva el enlace a `/login` dentro de la frase (por eso va subrayado). */
function ErrorText({ message }: { message: string }) {
  if (message !== DIGITAL_SESSION_ENDED_ERROR) {
    return message;
  }
  return (
    <>
      Tu sesión terminó.{" "}
      <Link href="/login" className="underline">
        Vuelve a ingresar
      </Link>
      .
    </>
  );
}

/** Éxito en `role="status"` y error en `role="alert"`; nada si no hay. */
export function DigitalMessage({ outcome, id }: { outcome: DigitalOutcome; id: string }) {
  if (outcome.kind === "done") {
    return (
      <p id={id} role="status" className="font-medium text-success">
        {outcome.text}
      </p>
    );
  }
  if (outcome.kind === "error") {
    return (
      <p id={id} role="alert" className="font-medium text-danger">
        <ErrorText message={outcome.message} />
      </p>
    );
  }
  return null;
}
