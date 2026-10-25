"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
// El orden importa, no lo reordenes: fija Zod sin compilación antes de cargar esquemas (CSP).
import "@/shared/ui/client-setup";
import type { SetMemberActiveInput } from "../schema";
import { activeNoticeText } from "./active-rules";
import { readRequestErrorMessage } from "./request-error";

// Las funciones puras viven en `active-rules.ts` (las pantallas de servidor las usan desde allí); se reexportan aquí.
export { activeNoticeText, canShowToggle, describeActiveState } from "./active-rules";

export const ACTIVE_NETWORK_MESSAGE = "No se pudo completar la acción";
export const ACTIVE_SESSION_ENDED_MESSAGE = "Tu sesión terminó. Vuelve a ingresar.";

const BUTTON_CLASS = "min-h-11 min-w-11 rounded px-4 font-medium";
const PRIMARY_CLASS = `${BUTTON_CLASS} bg-primary text-surface hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-control-border`;
const SECONDARY_CLASS = `${BUTTON_CLASS} border border-control-border bg-surface text-ink hover:bg-surface-alt disabled:cursor-not-allowed disabled:text-ink-muted`;

type CardError = { text: string; login: boolean };

/** Error de un cambio de estado: el estado HTTP y el mensaje que mandó el servidor (o el de respaldo). */
export class ToggleError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ToggleError";
    this.status = status;
  }
}

/**
 * Mensaje para un error de desactivar o reactivar. 401: sesión terminada; cualquier otro error del servidor (también
 * el 403 de la matriz de la regla 7) usa su propio mensaje; fallo de red o cuerpo ilegible: «No se pudo completar la
 * acción». El `catch` lo pasa tal cual, sin anotarle tipo.
 */
export function messageForToggleError<T>(error: T): string {
  if (!(error instanceof ToggleError)) {
    return ACTIVE_NETWORK_MESSAGE;
  }
  if (error.status === 401) {
    return ACTIVE_SESSION_ENDED_MESSAGE;
  }
  return error.message;
}

/** `true` si el error significa que hay que volver a ingresar (401). */
export function isSessionToggleError<T>(error: T): boolean {
  return error instanceof ToggleError && error.status === 401;
}

/** `PATCH /api/members/:id/active`. Si falla lanza `ToggleError`; un fallo de red sube tal cual. */
async function patchActive(memberId: string, active: boolean): Promise<void> {
  const body: SetMemberActiveInput = { active };
  const res = await fetch(`/api/members/${encodeURIComponent(memberId)}/active`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new ToggleError(res.status, await readRequestErrorMessage(res, ACTIVE_NETWORK_MESSAGE));
  }
}

type NoticeValue = { notice: string | null; setNotice: (text: string | null) => void; noticeId: string };

/** Sin proveedor, publicar un aviso no hace nada (p. ej. al probar el botón solo). */
const NoticeContext = createContext<NoticeValue>({ notice: null, setNotice: () => undefined, noticeId: "" });

/** Guarda el último aviso fuera de las tarjetas, para que sobreviva a la recarga de la lista. */
export function ActiveNoticeProvider({ children }: { children: ReactNode }) {
  const noticeId = useId();
  const [notice, setNotice] = useState<string | null>(null);
  return <NoticeContext.Provider value={{ notice, setNotice, noticeId }}>{children}</NoticeContext.Provider>;
}

/** Resultado del último cambio de estado, en `role="status"`. */
export function ActiveNotice() {
  const { notice, noticeId } = useContext(NoticeContext);
  if (notice === null) {
    return null;
  }
  return (
    <p id={noticeId} role="status" className="font-medium text-success">
      {notice}
    </p>
  );
}

function useActiveChange(memberId: string, memberName: string) {
  const router = useRouter();
  const { setNotice } = useContext(NoticeContext);
  const [refreshing, startRefresh] = useTransition();
  const busy = useRef(false);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<CardError | null>(null);

  async function change(next: boolean) {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      await patchActive(memberId, next);
    } catch (caught) {
      busy.current = false;
      setSending(false);
      setConfirming(false);
      setError({ text: messageForToggleError(caught), login: isSessionToggleError(caught) });
      return;
    }
    busy.current = false;
    setSending(false);
    setConfirming(false);
    setNotice(activeNoticeText(memberName, next));
    // Sigue deshabilitado mientras la lista se recarga.
    startRefresh(() => router.refresh());
  }

  function ask(next: boolean) {
    setError(null);
    setConfirming(next);
  }

  return { busy: sending || refreshing, confirming, error, change, ask };
}

function LoginLink({ visible }: { visible: boolean }) {
  if (!visible) {
    return null;
  }
  return (
    <Link href="/login" className="inline-flex min-h-11 items-center font-medium text-primary underline">
      Ingresar
    </Link>
  );
}

function CardMessage({ error, id }: { error: CardError | null; id: string }) {
  if (error === null) {
    return null;
  }
  return (
    <p id={id} role="alert" className="font-medium text-danger">
      {error.text} <LoginLink visible={error.login} />
    </p>
  );
}

type ConfirmProps = {
  name: string;
  busy: boolean;
  messageId: string | undefined;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Segundo paso de «Desactivar»: el foco cae en «Cancelar», la opción segura. */
function DeactivateConfirm({ name, busy, messageId, onConfirm, onCancel }: ConfirmProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  return (
    <>
      <button
        type="button"
        disabled={busy}
        aria-label={`Confirmar desactivación de ${name}`}
        aria-describedby={messageId}
        onClick={onConfirm}
        className={PRIMARY_CLASS}
      >
        Confirmar desactivación
      </button>
      <button
        ref={cancelRef}
        type="button"
        disabled={busy}
        aria-label={`Cancelar la desactivación de ${name}`}
        onClick={onCancel}
        className={SECONDARY_CLASS}
      >
        Cancelar
      </button>
    </>
  );
}

type ToggleProps = { memberId: string; memberName: string; active: boolean };

function ToggleButtons(props: ToggleProps & { c: ReturnType<typeof useActiveChange>; messageId: string | undefined }) {
  const { c, memberName: name, messageId } = props;
  const startRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (wasConfirming.current && !c.confirming) {
      startRef.current?.focus();
    }
    wasConfirming.current = c.confirming;
  }, [c.confirming]);
  if (!props.active) {
    return (
      <button
        type="button"
        disabled={c.busy}
        aria-label={`Reactivar a ${name}`}
        aria-describedby={messageId}
        onClick={() => void c.change(true)}
        className={PRIMARY_CLASS}
      >
        Reactivar
      </button>
    );
  }
  if (c.confirming) {
    return (
      <DeactivateConfirm
        name={name}
        busy={c.busy}
        messageId={messageId}
        onConfirm={() => void c.change(false)}
        onCancel={() => c.ask(false)}
      />
    );
  }
  return (
    <button
      ref={startRef}
      type="button"
      disabled={c.busy}
      aria-label={`Desactivar a ${name}`}
      aria-describedby={messageId}
      onClick={() => c.ask(true)}
      className={SECONDARY_CLASS}
    >
      Desactivar
    </button>
  );
}

/**
 * F14 · Botón de estado de una cuenta (regla 15). «Desactivar» va en dos pasos; «Reactivar», en uno. Solo se dibuja
 * cuando `canShowToggle` lo permite; el servidor vuelve a comprobar rol y destino.
 */
export function ActiveToggle({ memberId, memberName, active }: ToggleProps) {
  const errorId = useId();
  const c = useActiveChange(memberId, memberName);
  let messageId: string | undefined;
  if (c.error !== null) {
    messageId = errorId;
  }
  return (
    <section aria-label={`Estado de la cuenta de ${memberName}`} className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <ToggleButtons memberId={memberId} memberName={memberName} active={active} c={c} messageId={messageId} />
      </div>
      <CardMessage error={c.error} id={errorId} />
    </section>
  );
}
