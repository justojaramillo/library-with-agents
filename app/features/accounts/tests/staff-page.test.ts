import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import StaffPage from "@/personal/page";
import type { SessionUser } from "@/shared/schema";
import { attributeOf, fieldLabelled, openingTags, textOf } from "@/tests/helpers/html";
import { articlesOf, buttonLabelled, textOwners } from "@/tests/helpers/html-text";
import { type Account, type AccountsWorld, buttonsOf, makeAccountsWorld, stateOf } from "@/tests/helpers/staff-screens";
import { renderComplete } from "@/tests/helpers/render-page";

// Estado que las simulaciones leen al ejecutarse: el mundo en memoria, la sesión y las llamadas a `redirect`.
const state = vi.hoisted(() => ({
  // Al cargar el archivo la prueba del marco estático lanza un render que sigue en segundo plano: con un prestatario
  // de entrada ese render solo pinta el aviso de acceso, sin llamar a `redirect` ni al contenedor.
  user: { member_id: "uid-marco", role: "EXTERNO" } as { member_id: string; role: string } | null,
  redirected: [] as string[],
  container: null as null | { staff: object },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", async (importOriginal) => ({
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

let accounts: AccountsWorld;
let admin: Account;
let listSpy: MockInstance<AccountsWorld["staff"]["list"]>;

function signIn(person: { actor: SessionUser } | null): void {
  state.user = person?.actor ?? null;
}

beforeEach(async () => {
  accounts = makeAccountsWorld();
  state.redirected = [];
  state.container = { staff: accounts.staff };
  admin = await accounts.addAccount("ADMINISTRADOR", { name: "Rosa Admin" });
  signIn(admin);
  listSpy = vi.spyOn(accounts.staff, "list");
});

/** HTML completo de `/personal` (espera todo `<Suspense>`). */
function screen(): Promise<string> {
  return renderComplete(createElement(StaffPage));
}

/** Tarjeta de la persona con ese nombre. */
function cardOf(html: string, name: string): string {
  return articlesOf(html).find((card) => card.includes(`>${name}</h2>`)) ?? "";
}

describe("F13 · /personal · marco estático (regla 13)", () => {
  const html = renderToStaticMarkup(createElement(StaffPage));

  it("tiene un único <h1> «Personal» que nombra la sección", () => {
    const headings = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/g) ?? [];
    expect(headings).toHaveLength(1);
    expect(textOf(headings[0] ?? "")).toBe("Personal");
    const section = openingTags(html, "section")[0];
    expect(attributeOf(section, "aria-labelledby")).toBe(attributeOf(openingTags(html, "h1")[0], "id"));
  });

  it("mientras carga anuncia el estado y no pinta datos ni formulario", () => {
    expect(html).toContain("Cargando personal");
    expect(html).not.toMatch(/<article\b/);
    expect(html).not.toMatch(/<form\b/);
    expect(html).not.toContain("Solo para el administrador");
  });
});

describe("F13 · /personal · quién entra (regla 13 y autorización)", () => {
  it("sin sesión redirige a /login y no muestra formulario ni datos", async () => {
    signIn(null);

    const html = await screen();

    // React puede reintentar el render de la parte dinámica tras el redirect: lo que importa es el destino.
    expect(state.redirected.length).toBeGreaterThan(0);
    expect(new Set(state.redirected)).toEqual(new Set(["/login"]));
    expect(html).not.toMatch(/<form\b/);
    expect(html).not.toMatch(/<article\b/);
    expect(listSpy).not.toHaveBeenCalled();
  });

  it.each([
    "BIBLIOTECARIO",
    "EXTERNO",
    "ESTUDIANTE",
    "DOCENTE",
  ] as const)("un %s ve «Solo para el administrador.» como alerta, sin formulario ni lista", async (role) => {
    const other = await accounts.addAccount(role);
    await accounts.addAccount("BIBLIOTECARIO", { name: "Luis Gómez" });
    signIn(other);

    const html = await screen();

    expect(html).toMatch(/<p\b[^>]*role="alert"[^>]*>\s*Solo para el administrador\.\s*<\/p>/);
    expect(html).not.toMatch(/<form\b/);
    expect(html).not.toMatch(/<article\b/);
    expect(html).not.toContain("Luis Gómez");
    expect(html).not.toContain("Crear bibliotecario");
    expect(listSpy).not.toHaveBeenCalled();
    expect(state.redirected).toEqual([]);
  });

  it("el <h1> «Personal» está siempre, también para un bibliotecario", async () => {
    signIn(await accounts.addAccount("BIBLIOTECARIO"));

    const html = await screen();

    expect(html).toMatch(/<h1\b[^>]*>\s*Personal\s*<\/h1>/);
  });

  it("el administrador entra, no ve el aviso de acceso y el servicio recibe su sesión", async () => {
    const html = await screen();

    expect(html).not.toContain("Solo para el administrador");
    expect(state.redirected).toEqual([]);
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(listSpy.mock.calls[0]?.[0]).toEqual({ member_id: admin.id, role: "ADMINISTRADOR" });
  });
});

describe("F13 · /personal · formulario «Crear bibliotecario» (regla 13)", () => {
  it("el administrador ve la sección «Crear bibliotecario» con su formulario", async () => {
    const html = await screen();

    expect(html).toMatch(/<h2\b[^>]*id="personal-crear-titulo"[^>]*>\s*Crear bibliotecario\s*<\/h2>/);
    expect(html).toMatch(/<section\b[^>]*aria-labelledby="personal-crear-titulo"/);
    expect(html).toMatch(/<form\b/);
    expect(fieldLabelled(html, "Nombre")).not.toBeNull();
    expect(fieldLabelled(html, "Correo")).not.toBeNull();
    expect(fieldLabelled(html, "Contraseña")).not.toBeNull();
    expect(html).toContain("Entre 8 y 100 caracteres");
    expect(buttonLabelled(html, "Crear bibliotecario")).not.toBeNull();
  });

  it("el formulario aparece antes que la lista de personal", async () => {
    const html = await screen();

    expect(html.indexOf("Crear bibliotecario")).toBeGreaterThanOrEqual(0);
    expect(html.indexOf("<form")).toBeLessThan(html.indexOf("<article"));
  });
});

describe("F13 · /personal · lista de personal (regla 13)", () => {
  it("con 0 bibliotecarios solo sale el administrador, sin botón", async () => {
    const html = await screen();

    const cards = articlesOf(html);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toContain("Rosa Admin");
    expect(cards[0]).toContain("Administrador/a");
    expect(buttonsOf(cards[0])).toEqual([]);
    expect(html).not.toContain("No hay personal registrado.");
  });

  it("con 1 bibliotecario salen el administrador y el bibliotecario, con nombre, correo, rol y estado", async () => {
    const librarian = await accounts.addAccount("BIBLIOTECARIO", { name: "Luis Gómez" });

    const html = await screen();

    const cards = articlesOf(html);
    expect(cards).toHaveLength(2);
    const card = cardOf(html, "Luis Gómez");
    expect(card).toContain(librarian.email);
    expect(card).toContain("Bibliotecario/a");
    expect(stateOf(card)).toEqual({ text: "Activa", hasIcon: true });
  });

  it("las cuentas salen ordenadas por nombre", async () => {
    await accounts.addAccount("BIBLIOTECARIO", { name: "Zoila Peña" });
    await accounts.addAccount("BIBLIOTECARIO", { name: "Beatriz Lara" });

    const html = await screen();

    const names = articlesOf(html).map((card) => textOf(/<h2\b[^>]*>[\s\S]*?<\/h2>/.exec(card)?.[0] ?? ""));
    expect(names).toEqual(["Beatriz Lara", "Rosa Admin", "Zoila Peña"]);
  });

  it("no salen las cuentas de prestatarios", async () => {
    await accounts.addAccount("ESTUDIANTE", { name: "Ana Estudiante" });
    await accounts.addAccount("EXTERNO", { name: "Eva Externa" });
    await accounts.addAccount("DOCENTE", { name: "Dora Docente" });

    const html = await screen();

    expect(articlesOf(html)).toHaveLength(1);
    expect(html).not.toContain("Ana Estudiante");
    expect(html).not.toContain("Eva Externa");
    expect(html).not.toContain("Dora Docente");
  });

  it("el bibliotecario activo tiene «Desactivar» y el inactivo, «Reactivar»; el administrador, ninguno", async () => {
    await accounts.addAccount("BIBLIOTECARIO", { name: "Luis Gómez" });
    await accounts.addAccount("BIBLIOTECARIO", { name: "Marta Ruiz", active: false });

    const html = await screen();

    expect(buttonsOf(cardOf(html, "Luis Gómez"))).toEqual([
      { text: "Desactivar", label: "Desactivar a Luis Gómez", disabled: false },
    ]);
    expect(buttonsOf(cardOf(html, "Marta Ruiz"))).toEqual([
      { text: "Reactivar", label: "Reactivar a Marta Ruiz", disabled: false },
    ]);
    expect(stateOf(cardOf(html, "Marta Ruiz"))).toEqual({ text: "Inactiva", hasIcon: true });
    expect(buttonsOf(cardOf(html, "Rosa Admin"))).toEqual([]);
  });

  it("la lista refleja el estado actual: una cuenta desactivada después sale como «Inactiva»", async () => {
    const librarian = await accounts.addAccount("BIBLIOTECARIO", { name: "Luis Gómez" });
    expect(stateOf(cardOf(await screen(), "Luis Gómez"))?.text).toBe("Activa");

    await accounts.staff.setActive(admin.actor, librarian.id, false);

    const html = await screen();
    expect(stateOf(cardOf(html, "Luis Gómez"))?.text).toBe("Inactiva");
    expect(buttonsOf(cardOf(html, "Luis Gómez"))[0]?.text).toBe("Reactivar");
  });

  it("una cuenta nueva aparece en la lista tras crearla (la pantalla recarga la lista)", async () => {
    await accounts.staff.create(admin.actor, {
      name: "Nora Nueva",
      email: "nora@example.com",
      password: "clave-segura-123",
    });

    const html = await screen();

    expect(cardOf(html, "Nora Nueva")).toContain("nora@example.com");
    expect(cardOf(html, "Nora Nueva")).toContain("Bibliotecario/a");
  });

  it("nombre y correo con marcado salen escapados", async () => {
    await accounts.addAccount("BIBLIOTECARIO", { name: "<img src=x onerror=alert(1)> Luis" });

    const html = await screen();

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; Luis");
  });

  it("la sección de la lista se llama «Personal» y ningún <div> ni <span> lleva texto de datos", async () => {
    await accounts.addAccount("BIBLIOTECARIO", { name: "Luis Gómez" });

    const html = await screen();

    expect(html).toMatch(/<section\b[^>]*aria-label="Personal"/);
    const owners = textOwners(html);
    expect(owners.filter((owner) => owner.tag === "div" || owner.tag === "span")).toEqual([]);
  });
});
