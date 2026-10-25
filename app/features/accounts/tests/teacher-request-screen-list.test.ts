import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ROLE_LABELS } from "@/features/accounts/ui/role-labels";
import { ROLES } from "@/shared/schema";
import { attributeOf, hasAttribute, openingTags, tagById, textOf } from "@/tests/helpers/html";
import { articlesOf, buttonLabelled, textOwners } from "@/tests/helpers/html-text";
import { aDecidedItem, anItem } from "@/tests/helpers/request-items";
import type { TeacherRequestItem, TeacherRequestStatus } from "../schema";
import {
  describeEmailState,
  describeRequestStatus,
  EMPTY_REQUEST_TEXTS,
  emptyTextFor,
  TeacherRequestList,
} from "../ui/teacher-request-list";
import { UNVERIFIED_HINT } from "../ui/teacher-request-actions";
import { REQUEST_STATUS_TABS, RequestStatusNav, requestsHref } from "../ui/teacher-request-tabs";

// El navegador aporta el enrutador; en pruebas (entorno node) se sustituye por uno inerte.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

function renderList(requests: TeacherRequestItem[], status: TeacherRequestStatus = "PENDIENTE"): string {
  return renderToStaticMarkup(createElement(TeacherRequestList, { requests, status }));
}

function renderNav(current: TeacherRequestStatus): string {
  return renderToStaticMarkup(createElement(RequestStatusNav, { current }));
}

describe("F37 · tarjeta de una solicitud pendiente (regla 4)", () => {
  const html = renderList([anItem({ note: "Línea uno\nLínea dos" })]);

  it("va en una lista <ul> con un <li> y un <article>", () => {
    expect(html).toMatch(/<ul\b[^>]*>\s*<li\b[^>]*>\s*<article\b/);
    expect(articlesOf(html)).toHaveLength(1);
  });

  it("el nombre de la persona es un <h2>", () => {
    expect(html).toMatch(/<h2\b[^>]*>Ana Pérez<\/h2>/);
  });

  it("muestra el correo y el rol actual en español", () => {
    expect(html).toContain("ana@example.com");
    expect(html).toContain(ROLE_LABELS.EXTERNO);
  });

  it.each(ROLES)("muestra el rol %s con su etiqueta en español", (role) => {
    expect(renderList([anItem({ member_role: role })])).toContain(ROLE_LABELS[role]);
  });

  it("muestra «Enviada el» con la fecha en español dentro de <time datetime>", () => {
    expect(html).toMatch(/Enviada el\s*<time\b[^>]*>5 de enero de 2026<\/time>/);
    const time = openingTags(html, "time")[0];
    expect(attributeOf(time, "datetime")).toBe("2026-01-05T15:00:00.000Z");
  });

  it("la fecha de envío usa la zona America/Bogota: cerca de la medianoche UTC cambia de día", () => {
    const late = renderList([anItem({ requested_at: "2026-02-01T03:30:00.000Z" })]);
    expect(late).toContain("31 de enero de 2026");
    expect(late).not.toContain("1 de febrero de 2026");
  });

  it("muestra la nota completa respetando los saltos de línea", () => {
    expect(html).toContain("Línea uno\nLínea dos");
    const paragraph = /<p\b([^>]*)>Línea uno\nLínea dos<\/p>/.exec(html);
    expect(paragraph).not.toBeNull();
    expect(paragraph?.[1]).toContain("whitespace-pre-line");
  });

  it("muestra «Correo verificado» cuando lo está, con un icono decorativo y sin «sin verificar»", () => {
    expect(html).toContain("Correo verificado");
    expect(html).not.toContain("Correo sin verificar");
    expect(html).toMatch(/<svg\b[^>]*aria-hidden="true"/);
  });

  it("muestra «Correo sin verificar» (texto, no solo color) cuando no lo está", () => {
    const unverified = renderList([anItem({ email_verified: false })]);
    expect(unverified).toContain("Correo sin verificar");
    expect(unverified).not.toMatch(/Correo verificado/);
    expect(unverified).toMatch(/<svg\b[^>]*aria-hidden="true"/);
  });

  it("no muestra fecha de decisión ni motivo", () => {
    expect(html).not.toContain("Aprobada el");
    expect(html).not.toContain("Rechazada el");
    expect(html).not.toContain("Motivo:");
  });

  it("ningún <div> ni <span> lleva texto de datos (solo estructura)", () => {
    const owners = textOwners(renderList([anItem({ email_verified: false })]));
    const wrongOwners = owners.filter((owner) => owner.tag === "div" || owner.tag === "span");
    expect(wrongOwners).toEqual([]);
    expect(owners.length).toBeGreaterThan(0);
  });
});

describe("F37 · acciones de una pendiente (reglas 5, 6 y 7)", () => {
  it("con el correo verificado: «Aprobar» y «Rechazar» activos, con aria-label que incluye el nombre", () => {
    const html = renderList([anItem()]);
    const approve = buttonLabelled(html, "Aprobar");
    const reject = buttonLabelled(html, "Rechazar");
    expect(approve).not.toBeNull();
    expect(reject).not.toBeNull();
    expect(attributeOf(approve ?? "", "aria-label")).toBe("Aprobar a Ana Pérez");
    expect(attributeOf(reject ?? "", "aria-label")).toBe("Rechazar a Ana Pérez");
    expect(hasAttribute(approve ?? "", "disabled")).toBe(false);
    expect(hasAttribute(reject ?? "", "disabled")).toBe(false);
    expect(attributeOf(approve ?? "", "type")).toBe("button");
  });

  it("no muestra el segundo paso ni el formulario del motivo al empezar", () => {
    const html = renderList([anItem()]);
    expect(html).not.toContain("Confirmar aprobación");
    expect(html).not.toContain("Confirmar rechazo");
    expect(html).not.toContain("Cancelar");
    expect(html).not.toMatch(/<textarea\b/);
    expect(html).not.toContain(UNVERIFIED_HINT);
  });

  it("sin mensajes de éxito ni de error al empezar", () => {
    const html = renderList([anItem()]);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
  });

  it("los botones miden al menos 44 px (clases min-h-11 y min-w-11)", () => {
    const html = renderList([anItem()]);
    for (const text of ["Aprobar", "Rechazar"]) {
      const button = buttonLabelled(html, text) ?? "";
      expect(attributeOf(button, "class")).toContain("min-h-11");
      expect(attributeOf(button, "class")).toContain("min-w-11");
    }
  });

  it("con el correo sin verificar: «Aprobar» deshabilitado y el motivo visible", () => {
    const html = renderList([anItem({ email_verified: false })]);
    const approve = buttonLabelled(html, "Aprobar") ?? "";
    expect(hasAttribute(approve, "disabled")).toBe(true);
    expect(html).toContain(UNVERIFIED_HINT);
    expect(UNVERIFIED_HINT).toBe("No se puede aprobar hasta que la persona verifique su correo.");
  });

  it("el botón «Aprobar» deshabilitado queda enlazado al motivo con aria-describedby", () => {
    const html = renderList([anItem({ email_verified: false })]);
    const approve = buttonLabelled(html, "Aprobar") ?? "";
    const ids = (attributeOf(approve, "aria-describedby") ?? "").split(" ");
    const hint = ids.map((id) => tagById(html, id)).find((tag) => tag !== null);
    expect(hint).toBeDefined();
    expect(html).toMatch(new RegExp(`id="${ids[0]}"[^>]*>${UNVERIFIED_HINT}</p>`));
  });

  it("con el correo sin verificar «Rechazar» sigue disponible", () => {
    const html = renderList([anItem({ email_verified: false })]);
    const reject = buttonLabelled(html, "Rechazar") ?? "";
    expect(reject).not.toBe("");
    expect(hasAttribute(reject, "disabled")).toBe(false);
  });

  it("cada tarjeta tiene sus acciones con el nombre de su persona", () => {
    const html = renderList([
      anItem({ member_id: "uid-1", member_name: "Ana Pérez" }),
      anItem({ member_id: "uid-2", member_name: "Luis Gómez" }),
    ]);
    expect(html).toContain('aria-label="Aprobar a Ana Pérez"');
    expect(html).toContain('aria-label="Aprobar a Luis Gómez"');
    expect(html).toContain('aria-label="Rechazar a Luis Gómez"');
  });
});

describe("F37 · solicitudes resueltas, de solo lectura (reglas 4 y 5)", () => {
  it("una aprobada muestra «Aprobada el {fecha}» en <time datetime> y no tiene botones", () => {
    const html = renderList([aDecidedItem("APROBADA")], "APROBADA");
    expect(textOf(/<p\b[^>]*>Aprobada el[\s\S]*?<\/p>/.exec(html)?.[0] ?? "")).toBe("Aprobada el 30 de enero de 2026");
    const times = openingTags(html, "time");
    expect(times.map((time) => attributeOf(time, "datetime"))).toContain("2026-01-30T15:00:00.000Z");
    expect(html).not.toMatch(/<button\b/);
    expect(html).not.toMatch(/<textarea\b/);
    expect(html).not.toContain("Rechazada el");
  });

  it("una rechazada muestra «Rechazada el {fecha}» y no tiene botones", () => {
    const html = renderList([aDecidedItem("RECHAZADA")], "RECHAZADA");
    expect(html).toContain("Rechazada el");
    expect(html).toContain("30 de enero de 2026");
    expect(html).not.toMatch(/<button\b/);
    expect(html).not.toContain("Aprobada el");
  });

  it("muestra «Motivo: …» solo si hay motivo", () => {
    const withReason = renderList([aDecidedItem("RECHAZADA", { reason: "Falta soporte" })], "RECHAZADA");
    const withoutReason = renderList([aDecidedItem("RECHAZADA", { reason: null })], "RECHAZADA");
    const emptyReason = renderList([aDecidedItem("RECHAZADA", { reason: "" })], "RECHAZADA");
    expect(withReason).toContain("Motivo: Falta soporte");
    expect(withoutReason).not.toContain("Motivo:");
    expect(emptyReason).not.toContain("Motivo:");
  });

  it("una aprobada con motivo también lo muestra", () => {
    expect(renderList([aDecidedItem("APROBADA", { reason: "Verificado" })], "APROBADA")).toContain(
      "Motivo: Verificado",
    );
  });

  it("el motivo se escapa: un <b> aparece como texto", () => {
    const html = renderList([aDecidedItem("RECHAZADA", { reason: "<b>negrita</b>" })], "RECHAZADA");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;negrita&lt;/b&gt;");
  });

  it("la fecha de la decisión usa America/Bogota", () => {
    const html = renderList([aDecidedItem("APROBADA", { decided_at: "2026-02-01T03:30:00.000Z" })], "APROBADA");
    expect(html).toContain("31 de enero de 2026");
  });

  it("una resuelta sin fecha de decisión no inventa una y sigue sin botones", () => {
    const html = renderList([aDecidedItem("APROBADA", { decided_at: null })], "APROBADA");
    expect(html).not.toContain("Aprobada el");
    expect(html).not.toMatch(/<button\b/);
    expect(html).toContain("Ana Pérez");
  });

  it("también muestra la nota, el correo y el estado del correo", () => {
    const html = renderList([aDecidedItem("APROBADA")], "APROBADA");
    expect(html).toContain("Docente de Ingeniería, Universidad Nacional");
    expect(html).toContain("ana@example.com");
    expect(html).toContain("Correo verificado");
  });
});

describe("F37 · describeRequestStatus (función pura)", () => {
  it("una pendiente devuelve null", () => {
    expect(describeRequestStatus(anItem())).toBeNull();
  });

  it("una pendiente con fecha de decisión rara también devuelve null", () => {
    expect(
      describeRequestStatus({ status: "PENDIENTE", decided_at: "2026-01-30T15:00:00.000Z", reason: null }),
    ).toBeNull();
  });

  it.each(["APROBADA", "RECHAZADA"] as const)("una %s sin decided_at devuelve null", (status) => {
    expect(describeRequestStatus({ status, decided_at: null, reason: "x" })).toBeNull();
  });

  it("aprobada sin motivo: frase y fecha en español, reason null", () => {
    expect(describeRequestStatus(aDecidedItem("APROBADA"))).toEqual({
      prefix: "Aprobada el",
      date: "30 de enero de 2026",
      iso: "2026-01-30T15:00:00.000Z",
      text: "Aprobada el 30 de enero de 2026",
      reason: null,
    });
  });

  it("rechazada con motivo: «Motivo: …»", () => {
    const view = describeRequestStatus(aDecidedItem("RECHAZADA", { reason: "Falta soporte" }));
    expect(view?.text).toBe("Rechazada el 30 de enero de 2026");
    expect(view?.reason).toBe("Motivo: Falta soporte");
  });

  it("un motivo vacío cuenta como sin motivo", () => {
    expect(describeRequestStatus(aDecidedItem("RECHAZADA", { reason: "" }))?.reason).toBeNull();
  });

  it("por defecto usa America/Bogota y acepta otra zona", () => {
    const item = aDecidedItem("APROBADA", { decided_at: "2026-02-01T03:30:00.000Z" });
    expect(describeRequestStatus(item)?.date).toBe("31 de enero de 2026");
    expect(describeRequestStatus(item, "America/Bogota")?.date).toBe("31 de enero de 2026");
    expect(describeRequestStatus(item, "UTC")?.date).toBe("1 de febrero de 2026");
  });

  it("el instante exacto de la medianoche en Bogotá (05:00 UTC) ya es el día siguiente", () => {
    const item = aDecidedItem("APROBADA", { decided_at: "2026-02-01T05:00:00.000Z" });
    expect(describeRequestStatus(item)?.date).toBe("1 de febrero de 2026");
    const before = aDecidedItem("APROBADA", { decided_at: "2026-02-01T04:59:59.000Z" });
    expect(describeRequestStatus(before)?.date).toBe("31 de enero de 2026");
  });
});

describe("F37 · describeEmailState", () => {
  it("verificado y sin verificar", () => {
    expect(describeEmailState(true)).toBe("Correo verificado");
    expect(describeEmailState(false)).toBe("Correo sin verificar");
  });
});

describe("F37 · sin solicitudes (regla 3)", () => {
  it("tiene un texto por estado", () => {
    expect(EMPTY_REQUEST_TEXTS).toEqual({
      PENDIENTE: "No hay solicitudes pendientes.",
      APROBADA: "No hay solicitudes aprobadas.",
      RECHAZADA: "No hay solicitudes rechazadas.",
    });
  });

  it.each([
    "PENDIENTE",
    "APROBADA",
    "RECHAZADA",
  ] as const)("emptyTextFor(%s) devuelve el texto del estado", (status) => {
    expect(emptyTextFor(status)).toBe(EMPTY_REQUEST_TEXTS[status]);
  });

  it.each([
    "PENDIENTE",
    "APROBADA",
    "RECHAZADA",
  ] as const)("una lista de 0 en %s muestra solo su texto vacío", (status) => {
    const html = renderList([], status);
    expect(html).toContain(EMPTY_REQUEST_TEXTS[status]);
    expect(html).not.toMatch(/<ul\b/);
    expect(html).not.toMatch(/<article\b/);
  });

  it("el texto vacío de un estado no aparece en los otros", () => {
    const html = renderList([], "APROBADA");
    expect(html).not.toContain(EMPTY_REQUEST_TEXTS.PENDIENTE);
    expect(html).not.toContain(EMPTY_REQUEST_TEXTS.RECHAZADA);
  });

  it("con solicitudes no se muestra el texto vacío", () => {
    expect(renderList([anItem()])).not.toContain("No hay solicitudes");
  });
});

describe("F37 · cantidades (bordes)", () => {
  function many(count: number): TeacherRequestItem[] {
    return Array.from({ length: count }, (_, index) =>
      anItem({ member_id: `uid-${index}`, member_name: `Persona ${index}` }),
    );
  }

  it("1 solicitud: un artículo", () => {
    expect(articlesOf(renderList(many(1)))).toHaveLength(1);
  });

  it("2 solicitudes: dos artículos en el orden recibido", () => {
    const html = renderList(many(2));
    expect(articlesOf(html)).toHaveLength(2);
    expect(html.indexOf("Persona 0")).toBeLessThan(html.indexOf("Persona 1"));
  });

  it("50 solicitudes: 50 artículos y 50 elementos de lista", () => {
    const html = renderList(many(50));
    expect(articlesOf(html)).toHaveLength(50);
    expect(html.match(/<li\b/g)).toHaveLength(50);
  });
});

describe("F37 · seguridad del texto (regla 13)", () => {
  it("una nota con <script> aparece como texto escapado", () => {
    const html = renderList([anItem({ note: "Docente <script>alert(1)</script> de física" })]);
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("una nota con HTML de imagen no crea elementos", () => {
    const html = renderList([anItem({ note: '"><img src=x onerror=alert(1)> docente' })]);
    expect(html).not.toContain("<img");
  });

  it("el nombre y el correo se escapan", () => {
    const html = renderList([anItem({ member_name: "<b>Ana</b>", member_email: '"><i>x</i>@example.com' })]);
    expect(html).not.toContain("<b>Ana</b>");
    expect(html).not.toContain("<i>");
    expect(html).toContain("&lt;b&gt;Ana&lt;/b&gt;");
  });

  it("una nota con emojis se muestra completa", () => {
    expect(renderList([anItem({ note: "Docente de arte 🎨 y música 🎵" })])).toContain(
      "Docente de arte 🎨 y música 🎵",
    );
  });

  it("no usa dangerouslySetInnerHTML: el marcado de la nota nunca se interpreta", () => {
    const html = renderList([anItem({ note: "<h1>Título falso</h1> docente" })]);
    expect(html.match(/<h1\b/g)).toBeNull();
  });
});

describe("F37 · textos largos (regla 13 y bordes)", () => {
  it("un nombre de 120 caracteres se muestra completo en un <h2> con break-words", () => {
    const name = "N".repeat(120);
    const html = renderList([anItem({ member_name: name })]);
    expect(html).toContain(name);
    const heading = openingTags(html, "h2")[0];
    expect(attributeOf(heading, "class")).toContain("break-words");
  });

  it("una nota de 500 caracteres sin espacios se muestra completa en un párrafo con break-words", () => {
    const note = "x".repeat(500);
    const html = renderList([anItem({ note })]);
    const paragraph = new RegExp(`<p\\b([^>]*)>${note}</p>`).exec(html);
    expect(paragraph).not.toBeNull();
    expect(paragraph?.[1]).toContain("break-words");
  });

  it("un correo de 254 caracteres se muestra completo con break-words", () => {
    const email = `${"a".repeat(64)}@${"b".repeat(180)}.com`;
    const html = renderList([anItem({ member_email: email })]);
    expect(html).toContain(email);
    expect(html).toMatch(/<dd\b[^>]*class="[^"]*break-words[^"]*"[^>]*>a{64}@/);
  });

  it("un motivo largo sin espacios también se parte (break-words)", () => {
    const reason = "m".repeat(300);
    const html = renderList([aDecidedItem("RECHAZADA", { reason })], "RECHAZADA");
    expect(html).toMatch(new RegExp(`<p\\b[^>]*break-words[^>]*>Motivo: ${reason}</p>`));
  });

  it("la tarjeta no fuerza ancho: el elemento de lista permite encogerse (min-w-0)", () => {
    const li = openingTags(renderList([anItem()]), "li")[0];
    expect(attributeOf(li, "class")).toContain("min-w-0");
  });
});

describe("F37 · filtro por estado (regla 2)", () => {
  it("es una navegación con la etiqueta «Estado de las solicitudes»", () => {
    const nav = openingTags(renderNav("PENDIENTE"), "nav")[0];
    expect(attributeOf(nav, "aria-label")).toBe("Estado de las solicitudes");
  });

  it("tiene tres enlaces en orden: Pendientes, Aprobadas, Rechazadas", () => {
    expect(REQUEST_STATUS_TABS.map((tab) => tab.label)).toEqual(["Pendientes", "Aprobadas", "Rechazadas"]);
    const html = renderNav("PENDIENTE");
    const texts = [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map((link) => textOf(link[1]));
    expect(texts).toEqual(["Pendientes", "Aprobadas", "Rechazadas"]);
  });

  it("cada enlace apunta a /solicitudes?status=X", () => {
    expect(requestsHref("PENDIENTE")).toBe("/solicitudes?status=PENDIENTE");
    expect(requestsHref("APROBADA")).toBe("/solicitudes?status=APROBADA");
    expect(requestsHref("RECHAZADA")).toBe("/solicitudes?status=RECHAZADA");
    const hrefs = openingTags(renderNav("PENDIENTE"), "a").map((link) => attributeOf(link, "href"));
    expect(hrefs).toEqual([
      "/solicitudes?status=PENDIENTE",
      "/solicitudes?status=APROBADA",
      "/solicitudes?status=RECHAZADA",
    ]);
  });

  it.each([
    ["PENDIENTE", "Pendientes"],
    ["APROBADA", "Aprobadas"],
    ["RECHAZADA", "Rechazadas"],
  ] as const)('con %s activo solo «%s» lleva aria-current="page"', (current, label) => {
    const html = renderNav(current);
    const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
    const active = links.filter((link) => attributeOf(`<a${link[1]}>`, "aria-current") === "page");
    expect(active).toHaveLength(1);
    expect(textOf(active[0][2])).toBe(label);
    expect(html.match(/aria-current/g)).toHaveLength(1);
  });

  it("los enlaces miden al menos 44 px", () => {
    for (const link of openingTags(renderNav("APROBADA"), "a")) {
      expect(attributeOf(link, "class")).toContain("min-h-11");
    }
  });
});
