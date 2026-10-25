import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ClientSetup } from "@/shared/ui/client-setup";

describe("Enmienda de F10·F16·F17 · Zod sin compilación en el navegador (CSP)", () => {
  it("al importar client-setup, Zod queda en modo jitless", () => {
    expect(z.config().jitless).toBe(true);
  });

  it("ClientSetup no pinta nada", () => {
    expect(renderToStaticMarkup(createElement(ClientSetup))).toBe("");
    expect(ClientSetup()).toBeNull();
  });

  it("el layout monta ClientSetup como primer hijo de <body>", () => {
    const layout = readFileSync(resolve(import.meta.dirname, "../../layout.tsx"), "utf8");
    expect(layout).toMatch(/<body[^>]*>\s*<ClientSetup\s*\/>/);
    expect(layout.match(/<ClientSetup\b/g)).toHaveLength(1);
  });

  it("es un componente de cliente", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../ui/client-setup.tsx"), "utf8");
    expect(source).toMatch(/^\s*(\/\/.*\n\s*)*["']use client["']/);
  });
});
