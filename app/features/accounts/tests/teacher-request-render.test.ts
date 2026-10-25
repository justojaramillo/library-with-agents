import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NavBar } from "@/features/accounts/ui/nav-bar";
import { TeacherRequestPanel } from "@/features/accounts/ui/teacher-request-panel";
import { describeTeacherRequestState, type TeacherRequestView } from "@/features/accounts/ui/teacher-request-state";
import TeacherPage from "@/docente/page";
import type { Role } from "@/shared/schema";
import { attributeOf, fieldLabelled, hasAttribute, openingTags, tagById, textOf } from "@/tests/helpers/html";

// El navegador aporta el enrutador y el servidor la sesión: aquí no hay ni uno ni otro (la página solo pinta el marco).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  redirect: () => {
    throw new Error("la pantalla estática no debe redirigir");
  },
}));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("@/shared/server/http", () => ({
  getSessionUser: async () => {
    throw new Error("el marco estático no lee la sesión");
  },
}));
vi.mock("@/features/container", () => ({
  getContainer: () => {
    throw new Error("el marco estático no lee datos");
  },
}));

const NOW = new Date("2026-01-10T10:00:00.000Z");
const EMAIL = "ana@example.com";

function view(kind: TeacherRequestView["kind"]): TeacherRequestView {
  const requested = "2026-01-05T12:00:00.000Z";
  const base = {
    member_id: "uid-1",
    note: "Docente",
    requested_at: requested,
    decided_at: null,
    decided_by: null,
    reason: null,
  };
  const decided = { decided_at: NOW.toISOString(), decided_by: "uid-staff" };
  const states: Record<TeacherRequestView["kind"], TeacherRequestView> = {
    staff: describeTeacherRequestState("BIBLIOTECARIO", { request: null, email_verified: true }, NOW, "UTC"),
    teacher: describeTeacherRequestState("DOCENTE", { request: null, email_verified: true }, NOW, "UTC"),
    verify_email: describeTeacherRequestState("EXTERNO", { request: null, email_verified: false }, NOW, "UTC"),
    form: describeTeacherRequestState("EXTERNO", { request: null, email_verified: true }, NOW, "UTC"),
    pending: describeTeacherRequestState(
      "EXTERNO",
      { request: { ...base, status: "PENDIENTE" }, email_verified: true },
      NOW,
      "UTC",
    ),
    rejected: describeTeacherRequestState(
      "EXTERNO",
      { request: { ...base, ...decided, status: "RECHAZADA", reason: "Falta soporte" }, email_verified: true },
      NOW,
      "UTC",
    ),
  };
  return states[kind];
}

function panel(kind: TeacherRequestView["kind"]): string {
  return renderToStaticMarkup(createElement(TeacherRequestPanel, { view: view(kind), email: EMAIL }));
}

/** Etiqueta de apertura del botón con ese texto, o `null`. */
function buttonLabelled(html: string, text: string): string | null {
  for (const match of html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)) {
    if (textOf(match[2]) === text) {
      return `<button${match[1]}>`;
    }
  }
  return null;
}

describe("F11 · panel de /docente · formulario (regla 17)", () => {
  const html = panel("form");

  it("tiene el campo «Institución, facultad o cargo» como textarea obligatoria con su etiqueta", () => {
    expect(html).toMatch(/<textarea\b/);
    const field = fieldLabelled(html, "Institución, facultad o cargo");
    expect(field).not.toBeNull();
    expect(field).toMatch(/^<textarea\b/);
    expect(hasAttribute(field ?? "", "required")).toBe(true);
  });

  it("muestra el contador de caracteres enlazado al campo y el rango de 10 a 500", () => {
    const field = fieldLabelled(html, "Institución, facultad o cargo") ?? "";
    const hintId = attributeOf(field, "aria-describedby");
    expect(hintId).not.toBeNull();
    const first = (hintId ?? "").split(" ")[0];
    expect(tagById(html, first)).not.toBeNull();
    expect(html).toMatch(/0 de 500 caracteres/);
    expect(html).toMatch(/mínimo 10/);
  });

  it("tiene el botón «Enviar solicitud» activo", () => {
    const button = buttonLabelled(html, "Enviar solicitud");
    expect(button).not.toBeNull();
    expect(hasAttribute(button ?? "", "disabled")).toBe(false);
    expect(attributeOf(button ?? "", "type")).toBe("submit");
  });

  it("es un formulario con nombre accesible y sin mensajes de error al empezar", () => {
    const form = openingTags(html, "form")[0];
    expect(attributeOf(form, "aria-label")).toBe("Solicitar el rol de docente");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
  });

  it("no muestra el aviso de verificación ni el campo de contraseña", () => {
    expect(html).not.toContain("Verifica tu correo");
    expect(html).not.toContain('type="password"');
  });
});

describe("F11 · panel de /docente · correo sin verificar (regla 17 y 4)", () => {
  const html = panel("verify_email");

  it("muestra el aviso «Verifica tu correo» como encabezado", () => {
    expect(html).toMatch(/<h2\b[^>]*>Verifica tu correo<\/h2>/);
  });

  it("ofrece el botón «Enviar correo de verificación» con un campo de contraseña etiquetado", () => {
    expect(buttonLabelled(html, "Enviar correo de verificación")).not.toBeNull();
    const field = fieldLabelled(html, "Contraseña");
    expect(field).not.toBeNull();
    expect(attributeOf(field ?? "", "type")).toBe("password");
    expect(attributeOf(field ?? "", "autocomplete")).toBe("current-password");
  });

  it("no muestra el formulario de la solicitud", () => {
    expect(html).not.toMatch(/<textarea\b/);
    expect(html).not.toContain("Enviar solicitud");
  });

  it("no incluye la contraseña ni expone el correo como campo editable", () => {
    expect(openingTags(html, "input").filter((tag) => attributeOf(tag, "type") === "email")).toHaveLength(0);
  });

  it("empieza sin mensajes", () => {
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
  });
});

describe("F11 · panel de /docente · estados informativos (regla 17)", () => {
  it("pendiente: el texto exacto y la fecha de envío, sin formulario", () => {
    const html = panel("pending");

    expect(html).toContain("Tu solicitud está pendiente. El personal la revisará.");
    expect(html).toContain("5 de enero de 2026");
    expect(html).not.toMatch(/<form\b/);
    expect(html).not.toMatch(/<textarea\b/);
  });

  it("rechazada aún no reintentable: el texto exacto con el motivo y la fecha para volver a pedirla, sin formulario", () => {
    const html = panel("rejected");

    expect(html).toContain(
      "Tu solicitud fue rechazada el 10 de enero de 2026. Motivo: Falta soporte. Podrás volver a pedirla el 17 de enero de 2026.",
    );
    expect(html).not.toMatch(/<form\b/);
  });

  it("docente: «Ya tienes el rol de docente.» con el plazo y el cupo, sin formulario", () => {
    const html = panel("teacher");

    expect(html).toContain("Ya tienes el rol de docente.");
    expect(html).toMatch(/30 días/);
    expect(html).toMatch(/5 préstamos/);
    expect(html).not.toMatch(/<form\b/);
  });

  it("personal: «El personal no pide el rol de docente.» sin formulario", () => {
    const html = panel("staff");

    expect(html).toContain("El personal no pide el rol de docente.");
    expect(html).not.toMatch(/<form\b/);
    expect(html).not.toMatch(/<button\b/);
  });

  it.each([
    "pending",
    "rejected",
    "teacher",
  ] satisfies TeacherRequestView["kind"][])("el estado %s no tiene ningún botón ni campo", (kind) => {
    const html = panel(kind);

    expect(html).not.toMatch(/<button\b/);
    expect(html).not.toMatch(/<input\b/);
  });

  it("el motivo se escapa: no sale como HTML", () => {
    const hostile = describeTeacherRequestState(
      "EXTERNO",
      {
        request: {
          member_id: "uid-1",
          note: "Docente",
          status: "RECHAZADA",
          requested_at: "2026-01-05T12:00:00.000Z",
          decided_at: NOW.toISOString(),
          decided_by: "uid-staff",
          reason: "<script>alert(1)</script>",
        },
        email_verified: true,
      },
      NOW,
      "UTC",
    );

    const html = renderToStaticMarkup(createElement(TeacherRequestPanel, { view: hostile, email: EMAIL }));

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("F11 · página /docente · marco estático (regla 17)", () => {
  const html = renderToStaticMarkup(createElement(TeacherPage));

  it("tiene un único <h1> «Solicitar el rol de docente»", () => {
    const headings = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/g) ?? [];
    expect(headings).toHaveLength(1);
    expect(textOf(headings[0] ?? "")).toBe("Solicitar el rol de docente");
  });

  it("el título nombra la sección y, mientras carga, se anuncia el estado de carga", () => {
    const section = openingTags(html, "section")[0];
    const labelledBy = attributeOf(section, "aria-labelledby");
    expect(labelledBy).not.toBeNull();
    expect(tagById(html, labelledBy ?? "")).not.toBeNull();
    expect(html).toContain("Cargando tu solicitud");
  });

  it("no pinta datos de nadie antes de leer la sesión", () => {
    expect(html).not.toMatch(/<textarea\b/);
    expect(html).not.toContain("Tu solicitud está pendiente");
  });
});

describe("F11 · barra de navegación · enlace al rol de docente (regla 18)", () => {
  function bar(role: Role): string {
    return renderToStaticMarkup(createElement(NavBar, { user: { name: "Ana Pérez", role } }));
  }

  function linkTextsTo(html: string, href: string): string[] {
    const texts: string[] = [];
    for (const link of html.matchAll(/<a([^>]*)>([\s\S]*?)<\/a>/g)) {
      if (attributeOf(`<a${link[1]}>`, "href") === href) {
        texts.push(textOf(link[2]));
      }
    }
    return texts;
  }

  it.each(["EXTERNO", "ESTUDIANTE"] satisfies Role[])("un %s ve «Ser docente» enlazado a /docente", (role) => {
    const html = bar(role);

    expect(linkTextsTo(html, "/docente")).toEqual(["Ser docente"]);
    expect(html).not.toContain("Mi rol de docente");
  });

  it("un DOCENTE ve «Mi rol de docente» enlazado a /docente", () => {
    const html = bar("DOCENTE");

    expect(linkTextsTo(html, "/docente")).toEqual(["Mi rol de docente"]);
    expect(html).not.toContain("Ser docente");
  });

  it.each(["BIBLIOTECARIO", "ADMINISTRADOR"] satisfies Role[])("el %s no ve el enlace", (role) => {
    const html = bar(role);

    expect(html).not.toContain('href="/docente"');
    expect(html).not.toContain("Ser docente");
    expect(html).not.toContain("Mi rol de docente");
  });

  it("un visitante sin sesión no ve el enlace", () => {
    const html = renderToStaticMarkup(createElement(NavBar, { user: null }));

    expect(html).not.toContain('href="/docente"');
    expect(html).not.toContain("Ser docente");
  });

  it("el enlace va junto a los de préstamos del prestatario, después de «Mis vencidos»", () => {
    const html = bar("ESTUDIANTE");

    expect(html.indexOf('href="/mis-vencidos"')).toBeLessThan(html.indexOf('href="/docente"'));
  });
});
