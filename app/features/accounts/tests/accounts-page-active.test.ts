import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import AccountsPage from "@/cuentas/page";
import type { Role, SessionUser } from "@/shared/schema";
import { attributeOf, openingTags, textOf } from "@/tests/helpers/html";
import { articlesOf, textOwners } from "@/tests/helpers/html-text";
import { renderComplete } from "@/tests/helpers/render-page";
import { type Account, type AccountsWorld, buttonsOf, makeAccountsWorld, stateOf } from "@/tests/helpers/staff-screens";

// Estado que las simulaciones leen al ejecutarse: el mundo en memoria, la sesión y las llamadas a `redirect`.
const state = vi.hoisted(() => ({
  // Al cargar el archivo la prueba del marco estático lanza un render que sigue en segundo plano: con un prestatario
  // de entrada ese render solo pinta el aviso de acceso, sin llamar a `redirect` ni al contenedor.
  user: { member_id: "uid-marco", role: "EXTERNO" } as { member_id: string; role: string } | null,
  redirected: [] as string[],
  container: null as null | { members: object },
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

type SearchParams = Record<string, string | string[] | undefined>;

let accounts: AccountsWorld;
let listSpy: MockInstance<AccountsWorld["world"]["members"]["list"]>;

function signIn(person: { actor: SessionUser } | null): void {
  state.user = person?.actor ?? null;
}

beforeEach(() => {
  accounts = makeAccountsWorld();
  state.redirected = [];
  state.container = { members: accounts.world.members };
  state.user = null;
  listSpy = vi.spyOn(accounts.world.members, "list");
});

/** HTML completo de `/cuentas` con esos parámetros de dirección. */
function screen(searchParams: SearchParams = {}): Promise<string> {
  return renderComplete(
    createElement(AccountsPage, { params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) }),
  );
}

/** Tarjeta de la persona con ese nombre. */
function cardOf(html: string, name: string): string {
  return articlesOf(html).find((card) => card.includes(`>${name}</h2>`)) ?? "";
}

/** Una cuenta de cada rol de prestatario, más otro bibliotecario, y quien mira (con ese rol). */
async function seedAccounts(actorRole: Role): Promise<Account> {
  await accounts.addAccount("EXTERNO", { name: "Eva Externa" });
  await accounts.addAccount("ESTUDIANTE", { name: "Ana Estudiante" });
  await accounts.addAccount("DOCENTE", { name: "Dora Docente" });
  await accounts.addAccount("BIBLIOTECARIO", { name: "Otro Bibliotecario" });
  if (actorRole !== "ADMINISTRADOR") {
    await accounts.addAccount("ADMINISTRADOR", { name: "Rosa Admin" });
  }
  return accounts.addAccount(actorRole, { name: "Yo Mismo" });
}

describe("F14 · /cuentas · marco estático (regla 16)", () => {
  const html = renderToStaticMarkup(
    createElement(AccountsPage, { params: Promise.resolve({}), searchParams: Promise.resolve({}) }),
  );

  it("tiene un único <h1> «Cuentas» y, mientras carga, no pinta datos", () => {
    const headings = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/g) ?? [];
    expect(headings).toHaveLength(1);
    expect(textOf(headings[0] ?? "")).toBe("Cuentas");
    expect(html).toContain("Cargando cuentas");
    expect(html).not.toMatch(/<article\b/);
  });
});

describe("F14 · /cuentas · quién entra", () => {
  it("sin sesión redirige a /login", async () => {
    await seedAccounts("BIBLIOTECARIO");

    const html = await screen();

    expect(state.redirected).toEqual(["/login"]);
    expect(html).not.toMatch(/<article\b/);
    expect(listSpy).not.toHaveBeenCalled();
  });

  it.each([
    "EXTERNO",
    "ESTUDIANTE",
    "DOCENTE",
  ] as const)("un %s ve «Solo para el personal de la biblioteca.» y ni cuentas ni botones", async (role) => {
    signIn(await seedAccounts(role));

    const html = await screen();

    expect(html).toMatch(/<p\b[^>]*role="alert"[^>]*>\s*Solo para el personal de la biblioteca\.\s*<\/p>/);
    expect(html).not.toMatch(/<article\b/);
    expect(html).not.toMatch(/<button\b/);
    expect(listSpy).not.toHaveBeenCalled();
  });
});

describe("F14 · /cuentas · el bibliotecario ve botones según la regla 7 (regla 16)", () => {
  beforeEach(async () => {
    signIn(await seedAccounts("BIBLIOTECARIO"));
  });

  it("cada cuenta muestra «Activa» con icono", async () => {
    const html = await screen();

    expect(articlesOf(html)).toHaveLength(6);
    for (const card of articlesOf(html)) {
      expect(stateOf(card)).toEqual({ text: "Activa", hasIcon: true });
    }
  });

  it.each(["Eva Externa", "Ana Estudiante", "Dora Docente"])("ofrece «Desactivar» sobre %s", async (name) => {
    const html = await screen();

    expect(buttonsOf(cardOf(html, name)).map((button) => button.text)).toEqual(["Desactivar"]);
  });

  it.each(["Otro Bibliotecario", "Rosa Admin", "Yo Mismo"])("no ofrece botón sobre %s", async (name) => {
    const html = await screen();

    expect(cardOf(html, name)).not.toBe("");
    expect(buttonsOf(cardOf(html, name))).toEqual([]);
  });

  it("muestra exactamente tres botones en toda la pantalla", async () => {
    const html = await screen();

    expect(buttonsOf(html)).toHaveLength(3);
  });
});

describe("F14 · /cuentas · el administrador ve botones según la regla 7 (regla 16)", () => {
  beforeEach(async () => {
    signIn(await seedAccounts("ADMINISTRADOR"));
  });

  it.each([
    "Eva Externa",
    "Ana Estudiante",
    "Dora Docente",
    "Otro Bibliotecario",
  ])("ofrece «Desactivar» sobre %s", async (name) => {
    const html = await screen();

    expect(buttonsOf(cardOf(html, name)).map((button) => button.text)).toEqual(["Desactivar"]);
  });

  it("no ofrece botón sobre sí mismo", async () => {
    const html = await screen();

    expect(cardOf(html, "Yo Mismo")).not.toBe("");
    expect(buttonsOf(cardOf(html, "Yo Mismo"))).toEqual([]);
  });

  it("muestra exactamente cuatro botones", async () => {
    const html = await screen();

    expect(buttonsOf(html)).toHaveLength(4);
  });
});

describe("F14 · /cuentas · cuentas inactivas (reglas 15 y 16)", () => {
  it("una cuenta inactiva no se oculta: sale «Inactiva» con «Reactivar» para el bibliotecario", async () => {
    signIn(await seedAccounts("BIBLIOTECARIO"));
    await accounts.addAccount("ESTUDIANTE", { name: "Beto Baja", active: false });

    const html = await screen();

    const card = cardOf(html, "Beto Baja");
    expect(stateOf(card)).toEqual({ text: "Inactiva", hasIcon: true });
    expect(buttonsOf(card)).toEqual([{ text: "Reactivar", label: "Reactivar a Beto Baja", disabled: false }]);
  });

  it("un bibliotecario inactivo sale «Inactiva» y el bibliotecario no puede reactivarlo", async () => {
    await accounts.addAccount("BIBLIOTECARIO", { name: "Baja Bibliotecaria", active: false });
    signIn(await seedAccounts("BIBLIOTECARIO"));

    const html = await screen();

    expect(stateOf(cardOf(html, "Baja Bibliotecaria"))?.text).toBe("Inactiva");
    expect(buttonsOf(cardOf(html, "Baja Bibliotecaria"))).toEqual([]);
  });

  it("un bibliotecario inactivo sale «Inactiva» con «Reactivar» para el administrador", async () => {
    await accounts.addAccount("BIBLIOTECARIO", { name: "Baja Bibliotecaria", active: false });
    signIn(await seedAccounts("ADMINISTRADOR"));

    const html = await screen();

    expect(stateOf(cardOf(html, "Baja Bibliotecaria"))?.text).toBe("Inactiva");
    expect(buttonsOf(cardOf(html, "Baja Bibliotecaria")).map((button) => button.text)).toEqual(["Reactivar"]);
  });

  it("una cuenta desactivada después sale «Inactiva» en la siguiente carga", async () => {
    const actor = await seedAccounts("BIBLIOTECARIO");
    signIn(actor);
    const student = await accounts.addAccount("ESTUDIANTE", { name: "Beto Baja" });
    expect(stateOf(cardOf(await screen(), "Beto Baja"))?.text).toBe("Activa");

    await accounts.staff.setActive(actor.actor, student.id, false);

    expect(stateOf(cardOf(await screen(), "Beto Baja"))?.text).toBe("Inactiva");
  });
});

describe("F14 · /cuentas · la paginación no cambia (regla 16)", () => {
  async function fiftyOneAccounts(): Promise<{ people: Account[]; actor: Account }> {
    const people: Account[] = [];
    for (let index = 0; index < 50; index += 1) {
      people.push(await accounts.addAccount("ESTUDIANTE", { name: `Persona ${String(index).padStart(3, "0")}` }));
    }
    const actor = await accounts.addAccount("BIBLIOTECARIO", { name: "Zeta Actor" });
    return { people, actor };
  }

  it("51 cuentas: la primera página muestra 50 con sus botones y «Siguiente» lleva after", async () => {
    const { people, actor } = await fiftyOneAccounts();
    signIn(actor);

    const html = await screen();

    expect(articlesOf(html)).toHaveLength(50);
    expect(buttonsOf(html)).toHaveLength(50);
    const next = openingTags(html, "a")
      .map((link) => attributeOf(link, "href") ?? "")
      .find((href) => href.includes("after="));
    expect(next).toBe(`/cuentas?after=${people[49].id}`);
    expect(attributeOf(openingTags(html, "nav").at(-1) ?? "", "aria-label")).toBe("Paginación de cuentas");
    expect(html).not.toContain("Volver al inicio");
  });

  it("la segunda página trae la cuenta restante, sin botón sobre sí mismo, y «Volver al inicio»", async () => {
    const { people, actor } = await fiftyOneAccounts();
    signIn(actor);

    const html = await screen({ after: people[49].id });

    expect(articlesOf(html)).toHaveLength(1);
    expect(html).toContain("Zeta Actor");
    expect(buttonsOf(html)).toEqual([]);
    expect(html).toContain("Volver al inicio");
    expect(html).not.toContain("Siguiente");
  });

  it("un after inexistente sigue mostrando «No se encontró esa página»", async () => {
    signIn(await seedAccounts("BIBLIOTECARIO"));

    const html = await screen({ after: "desconocido" });

    expect(html).toMatch(/role="alert"[^>]*>\s*No se encontró esa página\. Vuelve al inicio\.\s*<\/p>/);
    expect(articlesOf(html)).toHaveLength(0);
  });

  it("pide al servicio 50 cuentas por página", async () => {
    signIn(await seedAccounts("BIBLIOTECARIO"));

    await screen();

    expect(listSpy.mock.calls[0]?.[0]).toMatchObject({ limit: 50 });
  });
});

describe("F14 · /cuentas · texto de personas escapado y HTML semántico", () => {
  it("nombre con marcado sale escapado también en los botones", async () => {
    signIn(await seedAccounts("ADMINISTRADOR"));
    await accounts.addAccount("ESTUDIANTE", { name: '"><img src=x onerror=alert(1)>' });

    const html = await screen();

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("ningún <div> ni <span> lleva texto de datos", async () => {
    signIn(await seedAccounts("ADMINISTRADOR"));

    const html = await screen();

    const owners = textOwners(html);
    expect(owners.filter((owner) => owner.tag === "div" || owner.tag === "span")).toEqual([]);
  });
});
