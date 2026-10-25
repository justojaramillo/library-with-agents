import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import RequestsPage from "@/solicitudes/page";
import type { SessionUser } from "@/shared/schema";
import { attributeOf, hasAttribute, openingTags, textOf } from "@/tests/helpers/html";
import { articlesOf, buttonLabelled } from "@/tests/helpers/html-text";
import { renderComplete } from "@/tests/helpers/render-page";
import { DAY_MS, makeTeacherWorld, T0, type Person, type TeacherWorld } from "@/tests/helpers/teacher-requests";
import { UNVERIFIED_HINT } from "../ui/teacher-request-actions";

// Estado que las simulaciones leen al ejecutarse: el mundo en memoria, la sesión y las llamadas a `redirect`.
const state = vi.hoisted(() => ({
  user: null as { member_id: string; role: string } | null,
  redirected: [] as string[],
  container: null as null | { teacherRequests: object },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", async (importOriginal) => ({
  // Se conserva el resto del módulo real (incluido `unstable_rethrow`): solo el enrutador y `redirect` se sustituyen.
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  redirect: (path: string) => {
    state.redirected.push(path);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("@/shared/server/http", () => ({ getSessionUser: async () => state.user }));
vi.mock("@/features/container", () => ({
  getContainer: () => state.container,
}));

type SearchParams = Record<string, string | string[] | undefined>;

let world: TeacherWorld;
let staff: Person;
let listSpy: MockInstance<TeacherWorld["service"]["list"]>;

function signIn(person: { actor: SessionUser } | null): void {
  state.user = person?.actor ?? null;
}

beforeEach(async () => {
  world = makeTeacherWorld();
  state.redirected = [];
  state.container = { teacherRequests: world.service };
  staff = await world.addPerson("BIBLIOTECARIO");
  signIn(staff);
  listSpy = vi.spyOn(world.service, "list");
});

/** HTML completo de la pantalla con esos parámetros de dirección. */
function screen(searchParams: SearchParams = {}): Promise<string> {
  return renderComplete(
    createElement(RequestsPage, { params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) }),
  );
}

/** Personas con solicitud pendiente, la primera enviada en `T0` y cada una un minuto después de la anterior. */
async function pendingPeople(count: number): Promise<Person[]> {
  const people: Person[] = [];
  for (let index = 0; index < count; index += 1) {
    const person = await world.addPerson("EXTERNO", { name: `Persona ${String(index).padStart(3, "0")}` });
    await world.ask(person, new Date(T0.getTime() + index * 60_000));
    people.push(person);
  }
  return people;
}

async function approvedPerson(name: string): Promise<Person> {
  const person = await world.addPerson("EXTERNO", { name });
  await world.ask(person, T0);
  await world.service.approve(staff.actor, person.id, new Date(T0.getTime() + DAY_MS));
  return person;
}

async function rejectedPerson(name: string, reason?: string): Promise<Person> {
  const person = await world.addPerson("ESTUDIANTE", { name });
  await world.ask(person, T0);
  await world.service.reject(staff.actor, person.id, { reason }, new Date(T0.getTime() + DAY_MS));
  return person;
}

function activeTabs(html: string): string[] {
  const nav = /<nav\b[^>]*aria-label="Estado de las solicitudes"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
  return [...nav.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
    .filter((link) => attributeOf(`<a${link[1]}>`, "aria-current") === "page")
    .map((link) => textOf(link[2]));
}

describe("F37 · /solicitudes · marco estático (regla 1)", () => {
  const html = renderToStaticMarkup(
    createElement(RequestsPage, { params: Promise.resolve({}), searchParams: Promise.resolve({}) }),
  );

  it("tiene un único <h1> «Solicitudes de docente» que nombra la sección", () => {
    const headings = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/g) ?? [];
    expect(headings).toHaveLength(1);
    expect(textOf(headings[0] ?? "")).toBe("Solicitudes de docente");
    const section = openingTags(html, "section")[0];
    expect(attributeOf(section, "aria-labelledby")).toBe(attributeOf(openingTags(html, "h1")[0], "id"));
  });

  it("mientras carga anuncia el estado y no pinta datos de nadie", () => {
    expect(html).toContain("Cargando solicitudes");
    expect(html).not.toMatch(/<article\b/);
    expect(html).not.toContain("Solo para el personal");
  });
});

describe("F37 · /solicitudes · quién entra (regla 1 y autorización)", () => {
  it("sin sesión redirige a /login y no muestra datos", async () => {
    signIn(null);
    await pendingPeople(1);

    const html = await screen();

    expect(state.redirected).toEqual(["/login"]);
    expect(html).not.toMatch(/<article\b/);
    expect(listSpy).not.toHaveBeenCalled();
  });

  it.each([
    "EXTERNO",
    "ESTUDIANTE",
    "DOCENTE",
  ] as const)("un %s ve «Solo para el personal de la biblioteca.» como alerta y ninguna solicitud", async (role) => {
    const borrower = await world.addPerson(role);
    await pendingPeople(2);
    signIn(borrower);

    const html = await screen();

    expect(html).toMatch(/<p\b[^>]*role="alert"[^>]*>\s*Solo para el personal de la biblioteca\.\s*<\/p>/);
    expect(html).not.toMatch(/<article\b/);
    expect(html).not.toContain("Persona 000");
    expect(html).not.toContain('aria-label="Estado de las solicitudes"');
    expect(listSpy).not.toHaveBeenCalled();
    expect(state.redirected).toEqual([]);
  });

  it.each(["BIBLIOTECARIO", "ADMINISTRADOR"] as const)("un %s entra y ve las solicitudes", async (role) => {
    const member = await world.addPerson(role);
    await pendingPeople(1);
    signIn(member);

    const html = await screen();

    expect(html).not.toContain("Solo para el personal");
    expect(articlesOf(html)).toHaveLength(1);
    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it("el <h1> «Solicitudes de docente» está siempre, también para un prestatario", async () => {
    signIn(await world.addPerson("ESTUDIANTE"));

    const html = await screen();

    expect(html).toMatch(/<h1\b[^>]*>\s*Solicitudes de docente\s*<\/h1>/);
  });
});

describe("F37 · /solicitudes · lista y estado (reglas 2 y 3)", () => {
  it("las pendientes salen de la más antigua a la más reciente, con nombre, correo, rol, fecha y nota", async () => {
    const [first, second] = await pendingPeople(2);

    const html = await screen();

    const cards = articlesOf(html);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toContain(first.name);
    expect(cards[0]).toContain(first.email);
    expect(cards[0]).toContain("Externo/a");
    expect(cards[0]).toContain("10 de enero de 2026");
    expect(cards[0]).toContain("Docente de Ingeniería, Universidad Nacional");
    expect(cards[1]).toContain(second.name);
  });

  it("sin parámetros: «Pendientes» activa con aria-current y las tres pestañas presentes", async () => {
    await pendingPeople(1);

    const html = await screen();

    expect(activeTabs(html)).toEqual(["Pendientes"]);
    expect(html).toContain('href="/solicitudes?status=APROBADA"');
    expect(html).toContain('href="/solicitudes?status=RECHAZADA"');
  });

  it("las pendientes tienen «Aprobar» y «Rechazar»", async () => {
    await pendingPeople(1);

    const html = await screen({ status: "PENDIENTE" });

    expect(buttonLabelled(html, "Aprobar")).not.toBeNull();
    expect(buttonLabelled(html, "Rechazar")).not.toBeNull();
  });

  it("con el correo sin verificar «Aprobar» queda deshabilitado y se lee el motivo", async () => {
    const person = await world.addPerson("EXTERNO");
    await world.ask(person, T0);
    world.identity.markEmailUnverified(person.id);

    const html = await screen();

    expect(hasAttribute(buttonLabelled(html, "Aprobar") ?? "", "disabled")).toBe(true);
    expect(html).toContain(UNVERIFIED_HINT);
    expect(html).toContain("Correo sin verificar");
    expect(hasAttribute(buttonLabelled(html, "Rechazar") ?? "", "disabled")).toBe(false);
  });

  it("?status=APROBADA muestra las aprobadas, sin botones, con «Aprobada el …» y rol de docente", async () => {
    await pendingPeople(1);
    const approved = await approvedPerson("Marta Ruiz");

    const html = await screen({ status: "APROBADA" });

    const cards = articlesOf(html);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toContain(approved.name);
    expect(cards[0]).toContain("Aprobada el");
    expect(cards[0]).toContain("11 de enero de 2026");
    expect(cards[0]).toContain("Docente");
    expect(html).not.toMatch(/<button\b/);
    expect(activeTabs(html)).toEqual(["Aprobadas"]);
    expect(html).not.toContain("Persona 000");
  });

  it("?status=RECHAZADA muestra las rechazadas con su motivo y sin botones", async () => {
    const rejected = await rejectedPerson("Pedro Soto", "Falta soporte");
    await rejectedPerson("Sin Motivo");

    const html = await screen({ status: "RECHAZADA" });

    const cards = articlesOf(html);
    expect(cards).toHaveLength(2);
    expect(html).toContain(rejected.name);
    expect(html).toContain("Rechazada el");
    expect(html).toContain("Motivo: Falta soporte");
    expect(html.match(/Motivo:/g)).toHaveLength(1);
    expect(html).not.toMatch(/<button\b/);
    expect(activeTabs(html)).toEqual(["Rechazadas"]);
  });

  it.each([
    ["algo", "valor inválido"],
    ["aprobada", "minúsculas"],
    ["", "vacío"],
    ["PENDIENTE; DROP", "con basura"],
  ])("?status=%s (%s) muestra las pendientes", async (status) => {
    await pendingPeople(1);
    await approvedPerson("Marta Ruiz");

    const html = await screen({ status });

    expect(activeTabs(html)).toEqual(["Pendientes"]);
    expect(articlesOf(html)).toHaveLength(1);
    expect(html).not.toContain("Marta Ruiz");
    expect(listSpy.mock.calls[0]?.[1]).toMatchObject({ status: "PENDIENTE" });
  });

  it("?status repetido (APROBADA y RECHAZADA) muestra las pendientes", async () => {
    await pendingPeople(1);
    await approvedPerson("Marta Ruiz");

    const html = await screen({ status: ["APROBADA", "RECHAZADA"] });

    expect(activeTabs(html)).toEqual(["Pendientes"]);
    expect(html).not.toContain("Marta Ruiz");
  });

  it.each([
    ["PENDIENTE", "No hay solicitudes pendientes."],
    ["APROBADA", "No hay solicitudes aprobadas."],
    ["RECHAZADA", "No hay solicitudes rechazadas."],
  ])("sin solicitudes en %s: «%s»", async (status, text) => {
    const html = await screen({ status });

    expect(html).toContain(text);
    expect(articlesOf(html)).toHaveLength(0);
    expect(html).not.toContain("Paginación");
  });
});

describe("F37 · /solicitudes · paginación (regla 2 y bordes)", () => {
  it("1 solicitud: una tarjeta y sin paginación", async () => {
    await pendingPeople(1);

    const html = await screen();

    expect(articlesOf(html)).toHaveLength(1);
    expect(html).not.toContain("Siguiente");
    expect(html).not.toContain("Volver al inicio");
  });

  it("50 solicitudes: 50 tarjetas y sin «Siguiente»", async () => {
    await pendingPeople(50);

    const html = await screen();

    expect(articlesOf(html)).toHaveLength(50);
    expect(html).not.toContain("Siguiente");
  });

  it("51 solicitudes: la primera página muestra 50 y «Siguiente» conserva status y lleva after; la segunda trae 1", async () => {
    const people = await pendingPeople(51);

    const first = await screen();

    expect(articlesOf(first)).toHaveLength(50);
    expect(first).toContain(people[0].name);
    expect(first).not.toContain(people[50].name);
    expect(first).not.toContain("Volver al inicio");
    const next = openingTags(first, "a")
      .map((link) => (attributeOf(link, "href") ?? "").replace(/&amp;/g, "&"))
      .find((href) => href.includes("after="));
    expect(next).toBeDefined();
    const query = new URL(next ?? "", "http://localhost").searchParams;
    expect(new URL(next ?? "", "http://localhost").pathname).toBe("/solicitudes");
    expect(query.get("status")).toBe("PENDIENTE");
    expect(query.get("after")).toBe(people[49].id);
    expect(attributeOf(openingTags(first, "nav").at(-1) ?? "", "aria-label")).toBe("Paginación de solicitudes");

    const second = await screen({ status: "PENDIENTE", after: people[49].id });

    expect(articlesOf(second)).toHaveLength(1);
    expect(second).toContain(people[50].name);
    expect(second).not.toContain("Siguiente");
    expect(second).toContain("Volver al inicio");
    expect(second).toContain('href="/solicitudes?status=PENDIENTE"');
  });

  it("un after inexistente muestra «No se encontró esa página. Vuelve al inicio.» y deja las pestañas", async () => {
    await pendingPeople(1);

    const html = await screen({ after: "desconocido" });

    expect(html).toMatch(/role="alert"[^>]*>\s*No se encontró esa página\. Vuelve al inicio\.\s*<\/p>/);
    expect(articlesOf(html)).toHaveLength(0);
    expect(activeTabs(html)).toEqual(["Pendientes"]);
    expect(html).toContain('href="/solicitudes?status=PENDIENTE"');
  });

  it("un after inexistente conserva el status en «Volver al inicio»", async () => {
    const html = await screen({ status: "RECHAZADA", after: "desconocido" });

    expect(html).toContain("No se encontró esa página");
    expect(activeTabs(html)).toEqual(["Rechazadas"]);
    expect(html).toMatch(/<a\b[^>]*href="\/solicitudes\?status=RECHAZADA"[^>]*>Volver al inicio<\/a>/);
  });

  it.each([
    ["a/b", "con barra"],
    ["", "vacío"],
  ])("un after mal formado (%s, %s) se ignora y muestra la primera página", async (after) => {
    await pendingPeople(2);

    const html = await screen({ after });

    expect(html).not.toContain("No se encontró esa página");
    expect(articlesOf(html)).toHaveLength(2);
    expect(listSpy.mock.calls[0]?.[1].after).toBeUndefined();
  });

  it("un after repetido (lista) se ignora", async () => {
    await pendingPeople(2);

    const html = await screen({ after: ["uno", "dos"] });

    expect(html).not.toContain("No se encontró esa página");
    expect(articlesOf(html)).toHaveLength(2);
    expect(listSpy.mock.calls[0]?.[1].after).toBeUndefined();
  });

  it("pide al servicio 50 por página con el estado y el cursor de la dirección", async () => {
    const [first] = await pendingPeople(2);

    await screen({ status: "PENDIENTE", after: first.id });

    expect(listSpy.mock.calls[0]?.[1]).toEqual({ status: "PENDIENTE", limit: 50, after: first.id });
  });
});

describe("F37 · /solicitudes · textos de personas escapados (regla 13)", () => {
  it("una nota con <script> y saltos de línea sale como texto y conserva los saltos", async () => {
    const person = await world.addPerson("EXTERNO");
    await world.ask(person, T0, "Docente <script>alert(1)</script>\nde la Facultad de Artes");

    const html = await screen();

    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;\nde la Facultad de Artes");
  });

  it("un nombre con marcado sale escapado", async () => {
    const person = await world.addPerson("EXTERNO", { name: "<img src=x onerror=alert(1)> Ana" });
    await world.ask(person, T0);

    const html = await screen();

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("F37 · /solicitudes · la lectura sigue al estado actual", () => {
  it("una solicitud aprobada deja de salir en «Pendientes» y aparece en «Aprobadas»", async () => {
    const person = await world.addPerson("EXTERNO", { name: "Marta Ruiz" });
    await world.ask(person, T0);
    expect(await screen()).toContain("Marta Ruiz");

    await world.service.approve(staff.actor, person.id, new Date(T0.getTime() + DAY_MS));

    expect(await screen()).not.toContain("Marta Ruiz");
    expect(await screen({ status: "APROBADA" })).toContain("Marta Ruiz");
  });

  it("una solicitud rechazada pasa a «Rechazadas»", async () => {
    const person = await world.addPerson("EXTERNO", { name: "Luis Gómez" });
    await world.ask(person, T0);

    await world.service.reject(staff.actor, person.id, { reason: "No aplica" }, new Date(T0.getTime() + DAY_MS));

    expect(await screen()).not.toContain("Luis Gómez");
    expect(await screen({ status: "RECHAZADA" })).toContain("Motivo: No aplica");
  });
});
