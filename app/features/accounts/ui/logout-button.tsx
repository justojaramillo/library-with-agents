"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Pide al servidor cerrar la sesión; un fallo no impide volver al inicio (regla 5). */
async function postLogout(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch (caught) {
    ignoreError(caught);
  }
}

/** El fallo de red se ignora a propósito: la barra se recarga y refleja el estado real. */
function ignoreError<T>(error: T): T {
  return error;
}

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onClick() {
    if (pending) {
      return;
    }
    setPending(true);
    try {
      await postLogout();
    } finally {
      router.push("/");
      router.refresh();
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="flex min-h-11 w-full items-center rounded px-3 text-left text-surface underline-offset-4 hover:bg-primary-hover hover:underline disabled:opacity-70"
    >
      Cerrar sesión
    </button>
  );
}
