"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
// El orden importa, no lo reordenes: fija Zod sin compilación antes de cargar esquemas (CSP).
import "@/shared/ui/client-setup";
import type { Book } from "@/features/catalog/schema";
import type { Member } from "@/features/accounts/schema";
import { LoanSchema, type LendInput } from "../schema";
import { readErrorMessage } from "./api-client";
import { BookPicker } from "./book-picker";
import { LocalDate } from "./local-date";
import { MemberPicker } from "./member-picker";

const LEND_ERROR = "No se pudo prestar";

type LendMessage =
  | { kind: "lent"; title: string; name: string; due_at: string }
  | { kind: "created" }
  | { kind: "error"; text: string };

/** `due_at` es null cuando el préstamo se creó pero el cuerpo de la respuesta no se pudo leer. */
type LendResult = { ok: true; due_at: string | null } | { ok: false; text: string };

/** Lee la fecha de vencimiento de un 201; si el cuerpo no encaja, el préstamo igual existe y devuelve null. */
async function readDueAt(res: Response): Promise<string | null> {
  try {
    const parsed = LoanSchema.safeParse(await res.json());
    if (parsed.success) {
      return parsed.data.due_at;
    }
  } catch {
    // Cuerpo ilegible: el préstamo ya se creó, se muestra un éxito genérico.
  }
  return null;
}

/** Envía el préstamo; la identidad del personal sale de la sesión del servidor. */
async function postLoan(input: LendInput): Promise<LendResult> {
  try {
    const res = await fetch("/api/loans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      return { ok: false, text: await readErrorMessage(res, LEND_ERROR) };
    }
    return { ok: true, due_at: await readDueAt(res) };
  } catch {
    return { ok: false, text: LEND_ERROR };
  }
}

function LendFeedback({ message, id }: { message: LendMessage | null; id: string }) {
  if (message === null) {
    return null;
  }
  if (message.kind === "error") {
    return (
      <p id={id} role="alert" className="font-medium text-danger">
        {message.text}
      </p>
    );
  }
  if (message.kind === "created") {
    return (
      <p id={id} role="status" className="font-medium text-success">
        Préstamo registrado.
      </p>
    );
  }
  return (
    <p id={id} role="status" className="font-medium text-success">
      Prestado «{message.title}» a {message.name}. Vence el <LocalDate iso={message.due_at} />.
    </p>
  );
}

/** Enlaza el formulario con el resultado solo cuando existe. */
function describedBy(message: LendMessage | null, id: string): string | undefined {
  if (message === null) {
    return undefined;
  }
  return id;
}

/** Mensaje de éxito: con fecha si se pudo leer; si no, el genérico. */
function lentMessage(dueAt: string | null, book: Book, member: Member): LendMessage {
  if (dueAt === null) {
    return { kind: "created" };
  }
  return { kind: "lent", title: book.title, name: member.name, due_at: dueAt };
}

/** F34 · Formulario de prestar: elige persona y libro con los buscadores y envía `POST /api/loans`. */
export function LendForm() {
  const router = useRouter();
  const messageId = useId();
  const [member, setMember] = useState<Member | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [message, setMessage] = useState<LendMessage | null>(null);
  const [sending, setSending] = useState(false);
  const busy = useRef(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (member === null || book === null || busy.current) {
      return;
    }
    busy.current = true;
    setSending(true);
    setMessage(null);
    const result = await postLoan({ member_id: member.id, book_id: book.id });
    busy.current = false;
    setSending(false);
    if (!result.ok) {
      setMessage({ kind: "error", text: result.text });
      return;
    }
    setMessage(lentMessage(result.due_at, book, member));
    setMember(null);
    setBook(null);
    router.refresh();
  }

  const canSubmit = member !== null && book !== null && !sending;

  return (
    <form
      onSubmit={onSubmit}
      aria-labelledby="prestar-titulo"
      aria-describedby={describedBy(message, messageId)}
      className="grid gap-4"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <MemberPicker selected={member} onSelect={setMember} onClear={() => setMember(null)} />
        <BookPicker selected={book} onSelect={setBook} onClear={() => setBook(null)} />
      </div>
      <LendFeedback message={message} id={messageId} />
      <button
        type="submit"
        disabled={!canSubmit}
        className="min-h-11 w-full rounded bg-primary px-4 font-medium text-surface hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-control-border md:w-auto md:justify-self-start"
      >
        Prestar
      </button>
    </form>
  );
}
