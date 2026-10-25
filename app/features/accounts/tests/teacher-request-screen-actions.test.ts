import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { attributeOf, hasAttribute, openingTags } from "@/tests/helpers/html";
import { buttonLabelled } from "@/tests/helpers/html-text";
import { HIDDEN_CHARACTERS_MESSAGE, RejectTeacherRequestInputSchema, TEACHER_REQUEST_RULES } from "../schema";
import { readRequestErrorMessage } from "../ui/request-error";
import {
  DecisionError,
  DecisionNotice,
  DecisionNoticeProvider,
  isConflictDecisionError,
  isSessionDecisionError,
  messageForDecisionError,
  NETWORK_MESSAGE,
  reasonLength,
  rejectBody,
  SESSION_ENDED_MESSAGE,
  successMessage,
  TeacherRequestActions,
  UNVERIFIED_HINT,
} from "../ui/teacher-request-actions";

// El navegador aporta el enrutador; en pruebas (entorno node) se sustituye por uno inerte.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

function renderActions(emailVerified: boolean): string {
  return renderToStaticMarkup(
    createElement(TeacherRequestActions, { memberId: "uid-ana", memberName: "Ana Pérez", emailVerified }),
  );
}

describe("F37 · textos de las acciones", () => {
  it("los textos fijos son los de la especificación", () => {
    expect(NETWORK_MESSAGE).toBe("No se pudo completar la acción");
    expect(SESSION_ENDED_MESSAGE).toBe("Tu sesión terminó. Vuelve a ingresar.");
    expect(UNVERIFIED_HINT).toBe("No se puede aprobar hasta que la persona verifique su correo.");
  });

  it("successMessage de aprobar: «Aprobada: {Nombre} ahora es docente.»", () => {
    expect(successMessage("approve", "Ana Pérez")).toBe("Aprobada: Ana Pérez ahora es docente.");
  });

  it("successMessage de rechazar: «Rechazada la solicitud de {Nombre}.»", () => {
    expect(successMessage("reject", "Ana Pérez")).toBe("Rechazada la solicitud de Ana Pérez.");
  });

  it("successMessage no interpreta el nombre (se muestra tal cual, React lo escapa)", () => {
    expect(successMessage("approve", "<b>Ana</b>")).toBe("Aprobada: <b>Ana</b> ahora es docente.");
  });
});

describe("F37 · motivo del rechazo: rejectBody y reasonLength (reglas 9 y 10)", () => {
  it("un motivo vacío no manda cuerpo (null)", () => {
    expect(rejectBody("")).toBeNull();
  });

  it("un motivo de solo espacios y saltos de línea tampoco manda cuerpo", () => {
    expect(rejectBody("   ")).toBeNull();
    expect(rejectBody(" \n\t ")).toBeNull();
  });

  it("un motivo con texto se manda recortado", () => {
    expect(rejectBody("  Falta soporte  ")).toEqual({ reason: "Falta soporte" });
  });

  it("conserva los saltos de línea del medio", () => {
    expect(rejectBody("Primera\nSegunda")).toEqual({ reason: "Primera\nSegunda" });
  });

  it("reasonLength cuenta el texto recortado: 0, 1, 300 y 301", () => {
    expect(reasonLength("")).toBe(0);
    expect(reasonLength("   ")).toBe(0);
    expect(reasonLength("a")).toBe(1);
    expect(reasonLength("  a  ")).toBe(1);
    expect(reasonLength("a".repeat(300))).toBe(300);
    expect(reasonLength("a".repeat(301))).toBe(301);
  });

  it("el máximo del contador es el del contrato (300)", () => {
    expect(TEACHER_REQUEST_RULES.reasonMax).toBe(300);
  });

  it("un motivo de 300 caracteres lo acepta el contrato; uno de 301, no", () => {
    const ok = rejectBody("a".repeat(300));
    const tooLong = rejectBody("a".repeat(301));
    expect(RejectTeacherRequestInputSchema.safeParse(ok).success).toBe(true);
    expect(RejectTeacherRequestInputSchema.safeParse(tooLong).success).toBe(false);
  });

  it("un motivo con U+200B se envía y el contrato responde con el mensaje de caracteres invisibles", () => {
    const body = rejectBody("Falta​soporte");
    expect(body).toEqual({ reason: "Falta​soporte" });
    const parsed = RejectTeacherRequestInputSchema.safeParse(body);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message)).toContain(HIDDEN_CHARACTERS_MESSAGE);
  });
});

describe("F37 · DecisionError", () => {
  it("guarda el estado HTTP y el mensaje", () => {
    const error = new DecisionError(409, "La solicitud ya fue resuelta.");
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(409);
    expect(error.message).toBe("La solicitud ya fue resuelta.");
  });
});

describe("F37 · messageForDecisionError (regla 11)", () => {
  it.each([401, 403])("%s: «Tu sesión terminó. Vuelve a ingresar.»", (status) => {
    expect(messageForDecisionError(new DecisionError(status, "Prohibido"))).toBe(SESSION_ENDED_MESSAGE);
  });

  it("409: el mensaje del servidor, «La solicitud ya fue resuelta.»", () => {
    expect(messageForDecisionError(new DecisionError(409, "La solicitud ya fue resuelta."))).toBe(
      "La solicitud ya fue resuelta.",
    );
  });

  it.each([
    "La cuenta ya no puede recibir el rol de docente.",
    "El correo de la persona ya no está verificado.",
  ])("409: «%s» se muestra tal cual", (text) => {
    expect(messageForDecisionError(new DecisionError(409, text))).toBe(text);
  });

  it("404: el mensaje del servidor", () => {
    expect(messageForDecisionError(new DecisionError(404, "La solicitud no existe"))).toBe("La solicitud no existe");
  });

  it("400: el mensaje del servidor (por ejemplo el de los caracteres invisibles)", () => {
    expect(messageForDecisionError(new DecisionError(400, HIDDEN_CHARACTERS_MESSAGE))).toBe(HIDDEN_CHARACTERS_MESSAGE);
  });

  it("500: el mensaje del servidor", () => {
    expect(messageForDecisionError(new DecisionError(500, "Error interno"))).toBe("Error interno");
  });

  it("un fallo de red (TypeError de fetch) dice «No se pudo completar la acción»", () => {
    expect(messageForDecisionError(new TypeError("Failed to fetch"))).toBe(NETWORK_MESSAGE);
  });

  it("un Error cualquiera dice «No se pudo completar la acción»", () => {
    expect(messageForDecisionError(new Error("boom"))).toBe(NETWORK_MESSAGE);
  });

  it("valores que no son errores dicen «No se pudo completar la acción»", () => {
    expect(messageForDecisionError("texto")).toBe(NETWORK_MESSAGE);
    expect(messageForDecisionError(undefined)).toBe(NETWORK_MESSAGE);
    expect(messageForDecisionError(null)).toBe(NETWORK_MESSAGE);
    expect(messageForDecisionError(42)).toBe(NETWORK_MESSAGE);
    expect(messageForDecisionError({ status: 401, message: "x" })).toBe(NETWORK_MESSAGE);
  });
});

describe("F37 · isSessionDecisionError e isConflictDecisionError", () => {
  it("401 y 403 son de sesión; el resto no", () => {
    expect(isSessionDecisionError(new DecisionError(401, "x"))).toBe(true);
    expect(isSessionDecisionError(new DecisionError(403, "x"))).toBe(true);
    for (const status of [400, 404, 409, 500]) {
      expect(isSessionDecisionError(new DecisionError(status, "x"))).toBe(false);
    }
  });

  it("solo 409 es conflicto", () => {
    expect(isConflictDecisionError(new DecisionError(409, "x"))).toBe(true);
    for (const status of [400, 401, 403, 404, 500]) {
      expect(isConflictDecisionError(new DecisionError(status, "x"))).toBe(false);
    }
  });

  it("lo que no es un DecisionError no es de sesión ni conflicto", () => {
    expect(isSessionDecisionError(new Error("x"))).toBe(false);
    expect(isConflictDecisionError(new Error("x"))).toBe(false);
    expect(isSessionDecisionError("401")).toBe(false);
    expect(isConflictDecisionError(409)).toBe(false);
    expect(isSessionDecisionError(null)).toBe(false);
    expect(isConflictDecisionError(undefined)).toBe(false);
  });
});

describe("F37 · readRequestErrorMessage (regla 10 y 11)", () => {
  const FALLBACK = "No se pudo completar la acción";

  function responseOf(body: string, status = 400): Response {
    return new Response(body, { status });
  }

  it("un 400 con el mensaje de caracteres invisibles en issues muestra ese mensaje", async () => {
    const body = JSON.stringify({
      error: "Datos inválidos",
      issues: [{ path: ["reason"], message: HIDDEN_CHARACTERS_MESSAGE }],
    });
    expect(await readRequestErrorMessage(responseOf(body), FALLBACK)).toBe(HIDDEN_CHARACTERS_MESSAGE);
  });

  it("si el mensaje de caracteres invisibles viene entre otros problemas, también gana", async () => {
    const body = JSON.stringify({
      error: "Datos inválidos",
      issues: [
        { path: ["reason"], message: "Máximo 300 caracteres" },
        { path: ["reason"], message: HIDDEN_CHARACTERS_MESSAGE },
      ],
    });
    expect(await readRequestErrorMessage(responseOf(body), FALLBACK)).toBe(HIDDEN_CHARACTERS_MESSAGE);
  });

  it("un 400 con otro problema (motivo de 301) muestra el campo «error»", async () => {
    const body = JSON.stringify({
      error: "Datos inválidos",
      issues: [{ path: ["reason"], message: "Too big" }],
    });
    expect(await readRequestErrorMessage(responseOf(body), FALLBACK)).toBe("Datos inválidos");
  });

  it("un 409 sin issues muestra el campo «error»", async () => {
    const body = JSON.stringify({ error: "La solicitud ya fue resuelta." });
    expect(await readRequestErrorMessage(responseOf(body, 409), FALLBACK)).toBe("La solicitud ya fue resuelta.");
  });

  it("issues vacío muestra el campo «error»", async () => {
    const body = JSON.stringify({ error: "Datos inválidos", issues: [] });
    expect(await readRequestErrorMessage(responseOf(body), FALLBACK)).toBe("Datos inválidos");
  });

  it("un cuerpo que no es JSON usa el mensaje de respaldo", async () => {
    expect(await readRequestErrorMessage(responseOf("<html>Bad gateway</html>", 502), FALLBACK)).toBe(FALLBACK);
  });

  it("un cuerpo vacío usa el mensaje de respaldo", async () => {
    expect(await readRequestErrorMessage(responseOf("", 500), FALLBACK)).toBe(FALLBACK);
  });

  it("un JSON que no cumple el contrato usa el mensaje de respaldo", async () => {
    expect(await readRequestErrorMessage(responseOf(JSON.stringify({ mensaje: "x" })), FALLBACK)).toBe(FALLBACK);
    expect(await readRequestErrorMessage(responseOf(JSON.stringify({ error: 5 })), FALLBACK)).toBe(FALLBACK);
    expect(await readRequestErrorMessage(responseOf("null"), FALLBACK)).toBe(FALLBACK);
    expect(await readRequestErrorMessage(responseOf("[]"), FALLBACK)).toBe(FALLBACK);
  });

  it("usa el respaldo que se le pasa, sea cual sea", async () => {
    expect(await readRequestErrorMessage(responseOf("no json"), "Otro respaldo")).toBe("Otro respaldo");
  });
});

describe("F37 · TeacherRequestActions · estado inicial (reglas 5 a 7)", () => {
  it("es una sección con nombre accesible que incluye a la persona", () => {
    const section = openingTags(renderActions(true), "section")[0];
    expect(attributeOf(section, "aria-label")).toBe("Acciones para Ana Pérez");
  });

  it("con el correo verificado: «Aprobar» y «Rechazar» activos y sin el aviso", () => {
    const html = renderActions(true);
    expect(hasAttribute(buttonLabelled(html, "Aprobar") ?? "", "disabled")).toBe(false);
    expect(hasAttribute(buttonLabelled(html, "Rechazar") ?? "", "disabled")).toBe(false);
    expect(html).not.toContain(UNVERIFIED_HINT);
  });

  it("con el correo sin verificar: «Aprobar» deshabilitado, aviso visible y «Rechazar» activo", () => {
    const html = renderActions(false);
    expect(hasAttribute(buttonLabelled(html, "Aprobar") ?? "", "disabled")).toBe(true);
    expect(hasAttribute(buttonLabelled(html, "Rechazar") ?? "", "disabled")).toBe(false);
    expect(html).toContain(UNVERIFIED_HINT);
  });

  it("no muestra confirmaciones, formulario, errores ni el enlace a /login", () => {
    const html = renderActions(true);
    expect(html).not.toContain("Confirmar");
    expect(html).not.toMatch(/<textarea\b/);
    expect(html).not.toMatch(/<form\b/);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('href="/login"');
  });
});

describe("F37 · DecisionNotice (regla 8)", () => {
  it("sin proveedor no pinta nada", () => {
    expect(renderToStaticMarkup(createElement(DecisionNotice))).toBe("");
  });

  it("con proveedor y sin aviso tampoco", () => {
    const html = renderToStaticMarkup(
      createElement(DecisionNoticeProvider, null, createElement(DecisionNotice), createElement("p", null, "contenido")),
    );
    expect(html).toBe("<p>contenido</p>");
  });
});
