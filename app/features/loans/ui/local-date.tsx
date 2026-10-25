"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_TIME_ZONE, formatDate, formatDateTime } from "./format";

/** La zona del navegador no cambia mientras la página está abierta: no hay nada a qué suscribirse. */
function subscribe(): () => void {
  return () => undefined;
}

function getBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function getServerTimeZone(): string {
  return DEFAULT_TIME_ZONE;
}

/**
 * Fecha en la hora local de quien mira (regla 16 de F34). El servidor y la hidratación usan
 * `America/Bogota`; ya montado, React vuelve a dibujar con la zona del navegador. El `<time datetime>`
 * es el mismo en ambos casos. No se usa geolocalización.
 */
export function LocalDate({ iso, withTime = false }: { iso: string; withTime?: boolean }) {
  const timeZone = useSyncExternalStore(subscribe, getBrowserTimeZone, getServerTimeZone);
  if (withTime) {
    return <time dateTime={iso}>{formatDateTime(iso, timeZone)}</time>;
  }
  return <time dateTime={iso}>{formatDate(iso, timeZone)}</time>;
}
