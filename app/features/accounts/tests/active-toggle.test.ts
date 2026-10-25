import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { attributeOf, hasAttribute, openingTags } from "@/tests/helpers/html";
import { buttonLabelled } from "@/tests/helpers/html-text";
import { buttonsOf } from "@/tests/helpers/staff-screens";
import {
  ACTIVE_NETWORK_MESSAGE,
  ACTIVE_SESSION_ENDED_MESSAGE,
  ActiveNotice,
  ActiveNoticeProvider,
  ActiveToggle,
  isSessionToggleError,
  messageForToggleError,
  ToggleError,
} from "../ui/active-toggle";

// El navegador aporta el enrutador; en pruebas (entorno node) se sustituye por uno inerte.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

function renderToggle(active: boolean, memberName = "Ana Pérez"): string {
  return renderToStaticMarkup(createElement(ActiveToggle, { memberId: "uid-ana", memberName, active }));
}

describe("F14 · textos fijos", () => {
  it("los mensajes de respaldo son los de la especificación", () => {
    expect(ACTIVE_NETWORK_MESSAGE).toBe("No se pudo completar la acción");
    expect(ACTIVE_SESSION_ENDED_MESSAGE).toBe("Tu sesión terminó. Vuelve a ingresar.");
  });

  it("ToggleError guarda el estado HTTP y el mensaje", () => {
    const error = new ToggleError(403, "El administrador no se puede desactivar.");
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(403);
    expect(error.message).toBe("El administrador no se puede desactivar.");
  });
});

describe("F14 · messageForToggleError (regla 15)", () => {
  it("401: «Tu sesión terminó. Vuelve a ingresar.», aunque el servidor mande otro texto", () => {
    expect(messageForToggleError(new ToggleError(401, "Falta iniciar sesión"))).toBe(ACTIVE_SESSION_ENDED_MESSAGE);
  });

  it.each([
    "Un bibliotecario no puede cambiar el estado de otro personal.",
    "El administrador no se puede desactivar.",
    "No puedes cambiar el estado de tu propia cuenta.",
    "Solo para personal de la biblioteca",
  ])("403: muestra el mensaje del servidor «%s», no el de sesión terminada", (text) => {
    expect(messageForToggleError(new ToggleError(403, text))).toBe(text);
  });

  it("404: el mensaje del servidor", () => {
    expect(messageForToggleError(new ToggleError(404, "La cuenta no existe."))).toBe("La cuenta no existe.");
  });

  it("400: el mensaje del servidor", () => {
    expect(messageForToggleError(new ToggleError(400, "Datos inválidos"))).toBe("Datos inválidos");
  });

  it("500: el mensaje del servidor", () => {
    expect(messageForToggleError(new ToggleError(500, "Error interno"))).toBe("Error interno");
  });

  it("un fallo de red (TypeError de fetch) dice «No se pudo completar la acción»", () => {
    expect(messageForToggleError(new TypeError("Failed to fetch"))).toBe(ACTIVE_NETWORK_MESSAGE);
  });

  it("un Error cualquiera dice «No se pudo completar la acción»", () => {
    expect(messageForToggleError(new Error("boom"))).toBe(ACTIVE_NETWORK_MESSAGE);
  });

  it("valores que no son errores dicen «No se pudo completar la acción»", () => {
    expect(messageForToggleError("texto")).toBe(ACTIVE_NETWORK_MESSAGE);
    expect(messageForToggleError(undefined)).toBe(ACTIVE_NETWORK_MESSAGE);
    expect(messageForToggleError(null)).toBe(ACTIVE_NETWORK_MESSAGE);
    expect(messageForToggleError(42)).toBe(ACTIVE_NETWORK_MESSAGE);
    expect(messageForToggleError({ status: 401, message: "x" })).toBe(ACTIVE_NETWORK_MESSAGE);
  });
});

describe("F14 · isSessionToggleError", () => {
  it("solo el 401 pide volver a ingresar", () => {
    expect(isSessionToggleError(new ToggleError(401, "x"))).toBe(true);
    for (const status of [400, 403, 404, 409, 500]) {
      expect(isSessionToggleError(new ToggleError(status, "x"))).toBe(false);
    }
  });

  it("lo que no es un ToggleError no es de sesión", () => {
    expect(isSessionToggleError(new Error("x"))).toBe(false);
    expect(isSessionToggleError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isSessionToggleError("401")).toBe(false);
    expect(isSessionToggleError(401)).toBe(false);
    expect(isSessionToggleError(null)).toBe(false);
    expect(isSessionToggleError(undefined)).toBe(false);
    expect(isSessionToggleError({ status: 401 })).toBe(false);
  });
});

describe("F14 · ActiveToggle · estado inicial de una cuenta activa (regla 15)", () => {
  const html = renderToggle(true);

  it("es una sección con nombre accesible que incluye a la persona", () => {
    expect(attributeOf(openingTags(html, "section")[0], "aria-label")).toBe("Estado de la cuenta de Ana Pérez");
  });

  it("ofrece un único botón «Desactivar», habilitado, de tipo button", () => {
    const buttons = buttonsOf(html);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toEqual({ text: "Desactivar", label: "Desactivar a Ana Pérez", disabled: false });
    expect(attributeOf(buttonLabelled(html, "Desactivar") ?? "", "type")).toBe("button");
  });

  it("desactivar es de dos pasos: al empezar no se ve la confirmación ni «Cancelar»", () => {
    expect(html).not.toContain("Confirmar desactivación");
    expect(html).not.toContain("Cancelar");
    expect(html).not.toContain("Reactivar");
  });

  it("al empezar no hay errores ni enlace a /login", () => {
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('href="/login"');
  });

  it("el botón mide al menos 44 px (min-h-11 y min-w-11)", () => {
    const button = buttonLabelled(html, "Desactivar") ?? "";
    expect(attributeOf(button, "class")).toContain("min-h-11");
    expect(attributeOf(button, "class")).toContain("min-w-11");
  });

  it("el aria-label contiene el texto visible y el nombre de la persona", () => {
    const label = attributeOf(buttonLabelled(html, "Desactivar") ?? "", "aria-label") ?? "";
    expect(label).toContain("Desactivar");
    expect(label).toContain("Ana Pérez");
  });
});

describe("F14 · ActiveToggle · estado inicial de una cuenta inactiva (regla 15)", () => {
  const html = renderToggle(false);

  it("ofrece un único botón «Reactivar» de un clic, habilitado", () => {
    const buttons = buttonsOf(html);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toEqual({ text: "Reactivar", label: "Reactivar a Ana Pérez", disabled: false });
    expect(hasAttribute(buttonLabelled(html, "Reactivar") ?? "", "disabled")).toBe(false);
  });

  it("no pide confirmación ni ofrece desactivar", () => {
    expect(html).not.toContain("Desactivar");
    expect(html).not.toContain("Confirmar");
    expect(html).not.toContain("Cancelar");
  });

  it("el botón mide al menos 44 px y el aria-label contiene texto visible y nombre", () => {
    const button = buttonLabelled(html, "Reactivar") ?? "";
    expect(attributeOf(button, "class")).toContain("min-h-11");
    expect(attributeOf(button, "class")).toContain("min-w-11");
    expect(attributeOf(button, "aria-label")).toBe("Reactivar a Ana Pérez");
  });
});

describe("F14 · ActiveToggle · nombres de personas", () => {
  it("un nombre con marcado sale escapado en el nombre accesible", () => {
    const html = renderToggle(true, '"><img src=x onerror=alert(1)>');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("un nombre de 120 caracteres se usa completo en los nombres accesibles", () => {
    const name = "N".repeat(120);
    const html = renderToggle(false, name);
    expect(html).toContain(`aria-label="Reactivar a ${name}"`);
    expect(html).toContain(`aria-label="Estado de la cuenta de ${name}"`);
  });
});

describe("F14 · ActiveNotice (regla 15)", () => {
  it("sin proveedor no pinta nada", () => {
    expect(renderToStaticMarkup(createElement(ActiveNotice))).toBe("");
  });

  it("con proveedor y sin aviso tampoco pinta nada", () => {
    const html = renderToStaticMarkup(
      createElement(ActiveNoticeProvider, null, createElement(ActiveNotice), createElement("p", null, "contenido")),
    );
    expect(html).toBe("<p>contenido</p>");
  });
});
