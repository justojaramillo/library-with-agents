"use client";

import { z } from "zod";

// La CSP bloquea Function("") que Zod prueba al cargar: sin compilación no hay aviso en la consola.
z.config({ jitless: true });

/** Fija la configuración global del navegador al cargar el módulo; no dibuja nada. */
export function ClientSetup() {
  return null;
}
