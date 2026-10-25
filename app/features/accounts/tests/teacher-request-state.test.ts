import { FirebaseError } from "firebase/app";
import { describe, expect, it } from "vitest";
import { ROLES, type Role, STAFF_ROLES } from "@/shared/schema";
import { DAY_MS, T0 } from "@/tests/helpers/teacher-requests";
import type { MyTeacherRequest, TeacherRequest } from "../schema";
import { messageForVerificationError } from "../ui/verify-email-form";
import { describeTeacherRequestState, retryAfterOf } from "../ui/teacher-request-state";

const DECIDED = new Date("2026-01-10T10:00:00.000Z");
const NO_REQUEST_VERIFIED: MyTeacherRequest = { request: null, email_verified: true };
const NO_REQUEST_UNVERIFIED: MyTeacherRequest = { request: null, email_verified: false };

function requestOf(over: Partial<TeacherRequest> = {}): TeacherRequest {
  return {
    member_id: "uid-1",
    note: "Docente de Ingeniería",
    status: "PENDIENTE",
    requested_at: "2026-01-05T12:00:00.000Z",
    decided_at: null,
    decided_by: null,
    reason: null,
    ...over,
  };
}

function rejected(reason: string | null = "No pudimos comprobar tu cargo"): TeacherRequest {
  return requestOf({
    status: "RECHAZADA",
    decided_at: DECIDED.toISOString(),
    decided_by: "uid-staff",
    reason,
  });
}

function view(role: Role, mine: MyTeacherRequest, now: Date = T0) {
  return describeTeacherRequestState(role, mine, now, "UTC");
}

describe("F11 · /docente · personal (regla 17)", () => {
  it.each(STAFF_ROLES)("%s: mensaje «El personal no pide el rol de docente.» sin formulario", (role) => {
    expect(view(role, NO_REQUEST_UNVERIFIED)).toEqual({
      kind: "staff",
      text: "El personal no pide el rol de docente.",
      detail: null,
    });
  });

  it("el personal ve su mensaje aunque las lecturas traigan una solicitud", () => {
    expect(view("BIBLIOTECARIO", { request: requestOf(), email_verified: true }).kind).toBe("staff");
  });
});

describe("F11 · /docente · ya es docente (regla 17)", () => {
  it("muestra «Ya tienes el rol de docente.» con el plazo de 30 días y el cupo de 5 préstamos", () => {
    const result = view("DOCENTE", NO_REQUEST_UNVERIFIED);

    expect(result.kind).toBe("teacher");
    expect(result.text).toBe("Ya tienes el rol de docente.");
    expect(result.detail).toMatch(/30 días/);
    expect(result.detail).toMatch(/\b5\b/);
  });

  it("un DOCENTE con su solicitud aprobada también ve el estado de docente", () => {
    const approved = requestOf({ status: "APROBADA", decided_at: DECIDED.toISOString(), decided_by: "uid-staff" });

    expect(view("DOCENTE", { request: approved, email_verified: true }).kind).toBe("teacher");
  });

  it("un DOCENTE con el correo sin verificar sigue viendo el estado de docente", () => {
    expect(view("DOCENTE", NO_REQUEST_UNVERIFIED).kind).toBe("teacher");
  });
});

describe("F11 · /docente · sin solicitud (regla 17)", () => {
  it.each(["EXTERNO", "ESTUDIANTE"] satisfies Role[])("%s con el correo verificado: formulario", (role) => {
    expect(view(role, NO_REQUEST_VERIFIED)).toEqual({ kind: "form", text: null, detail: null });
  });

  it.each([
    "EXTERNO",
    "ESTUDIANTE",
  ] satisfies Role[])("%s con el correo sin verificar: aviso de verificación y no el formulario", (role) => {
    const result = view(role, NO_REQUEST_UNVERIFIED);

    expect(result.kind).toBe("verify_email");
    expect(result.text).toMatch(/verificar tu correo/i);
  });
});

describe("F11 · /docente · solicitud pendiente (regla 17)", () => {
  it("muestra «Tu solicitud está pendiente. El personal la revisará.» con la fecha de envío", () => {
    const result = view("ESTUDIANTE", { request: requestOf(), email_verified: true });

    expect(result.kind).toBe("pending");
    expect(result.text).toBe("Tu solicitud está pendiente. El personal la revisará.");
    expect(result.detail).toContain("5 de enero de 2026");
  });

  it("se muestra aunque el correo ya no esté verificado (el correo solo se exige para crear)", () => {
    const result = view("EXTERNO", { request: requestOf(), email_verified: false });

    expect(result.kind).toBe("pending");
  });

  it("la fecha usa la zona horaria pedida: a las 03:00 UTC del día 6 aún es el 5 en Bogotá", () => {
    const mine = { request: requestOf({ requested_at: "2026-01-06T03:00:00.000Z" }), email_verified: true };

    expect(describeTeacherRequestState("EXTERNO", mine, T0, "UTC").detail).toContain("6 de enero de 2026");
    expect(describeTeacherRequestState("EXTERNO", mine, T0, "America/Bogota").detail).toContain("5 de enero de 2026");
  });

  it("sin zona horaria usa la de Bogotá", () => {
    const mine = { request: requestOf({ requested_at: "2026-01-06T03:00:00.000Z" }), email_verified: true };

    expect(describeTeacherRequestState("EXTERNO", mine, T0).detail).toContain("5 de enero de 2026");
  });
});

describe("F11 · /docente · solicitud rechazada (regla 17)", () => {
  it("aún no reintentable: texto completo con la fecha del rechazo, el motivo y la fecha para volver a pedir", () => {
    const result = view("ESTUDIANTE", { request: rejected(), email_verified: true });

    expect(result.kind).toBe("rejected");
    expect(result.text).toBe(
      "Tu solicitud fue rechazada el 10 de enero de 2026. Motivo: No pudimos comprobar tu cargo. Podrás volver a pedirla el 17 de enero de 2026.",
    );
  });

  it("sin motivo: se omite esa frase", () => {
    const result = view("ESTUDIANTE", { request: rejected(null), email_verified: true });

    expect(result.text).toBe(
      "Tu solicitud fue rechazada el 10 de enero de 2026. Podrás volver a pedirla el 17 de enero de 2026.",
    );
    expect(result.text).not.toContain("Motivo");
  });

  it("rechazada hace 0 segundos: se muestra el rechazo", () => {
    expect(view("EXTERNO", { request: rejected(), email_verified: true }, DECIDED).kind).toBe("rejected");
  });

  it("rechazada hace 6 días 23 h 59 min 59 s: todavía se muestra el rechazo", () => {
    const now = new Date(DECIDED.getTime() + 7 * DAY_MS - 1000);

    expect(view("EXTERNO", { request: rejected(), email_verified: true }, now).kind).toBe("rejected");
  });

  it("el rechazo se muestra aunque el correo ya no esté verificado", () => {
    expect(view("EXTERNO", { request: rejected(), email_verified: false }).kind).toBe("rejected");
  });

  it("rechazada hace exactamente 7 días y con el correo verificado: vuelve el formulario", () => {
    const now = new Date(DECIDED.getTime() + 7 * DAY_MS);

    expect(view("EXTERNO", { request: rejected(), email_verified: true }, now)).toEqual({
      kind: "form",
      text: null,
      detail: null,
    });
  });

  it("rechazada hace más de 7 días y con el correo sin verificar: pide verificar, sin formulario", () => {
    const now = new Date(DECIDED.getTime() + 8 * DAY_MS);

    expect(view("EXTERNO", { request: rejected(), email_verified: false }, now).kind).toBe("verify_email");
  });

  it("rechazada hace 7 días menos 1 milisegundo: todavía bloqueada", () => {
    const now = new Date(DECIDED.getTime() + 7 * DAY_MS - 1);

    expect(view("EXTERNO", { request: rejected(), email_verified: true }, now).kind).toBe("rejected");
  });
});

describe("F11 · retryAfterOf", () => {
  it("es la fecha de la decisión más 7 días", () => {
    expect(retryAfterOf(rejected()).toISOString()).toBe(new Date(DECIDED.getTime() + 7 * DAY_MS).toISOString());
  });
});

describe("F11 · el estado es una función pura de sus entradas", () => {
  it("cubre los cinco roles sin lanzar y con un tipo conocido", () => {
    const kinds = ["staff", "teacher", "verify_email", "form", "pending", "rejected"];
    for (const role of ROLES) {
      expect(kinds).toContain(view(role, NO_REQUEST_VERIFIED).kind);
    }
  });

  it("el mismo estado en dos llamadas da el mismo resultado", () => {
    const mine = { request: rejected(), email_verified: true };

    expect(view("ESTUDIANTE", mine)).toEqual(view("ESTUDIANTE", mine));
  });
});

describe("F11 · reenvío del correo de verificación · mensajes (regla 4)", () => {
  const DEFAULT = "No se pudo enviar el correo. Inténtalo de nuevo.";

  it("auth/too-many-requests", () => {
    expect(messageForVerificationError(new FirebaseError("auth/too-many-requests", "x"))).toBe(
      "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.",
    );
  });

  it.each([
    "auth/wrong-password",
    "auth/invalid-credential",
    "auth/invalid-login-credentials",
    "auth/missing-password",
  ])("%s: contraseña incorrecta", (code) => {
    expect(messageForVerificationError(new FirebaseError(code, "x"))).toBe("Contraseña incorrecta.");
  });

  it.each([
    "auth/network-request-failed",
    "auth/internal-error",
    "auth/user-not-found",
  ])("%s: mensaje genérico, sin filtrar el código", (code) => {
    const message = messageForVerificationError(new FirebaseError(code, "detalle interno"));

    expect(message).toBe(DEFAULT);
    expect(message).not.toContain("detalle interno");
  });

  it("un error que no es de Firebase: mensaje genérico", () => {
    expect(messageForVerificationError(new Error("boom"))).toBe(DEFAULT);
    expect(messageForVerificationError("texto suelto")).toBe(DEFAULT);
    expect(messageForVerificationError(null)).toBe(DEFAULT);
  });
});
