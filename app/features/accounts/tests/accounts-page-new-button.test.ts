import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AccountsPage from "@/cuentas/page";
import type { Role } from "@/shared/schema";
import { attributeOf, openingTags, textOf } from "@/tests/helpers/html";
import { articlesOf, textOwners } from "@/tests/helpers/html-text";
import { renderComplete } from "@/tests/helpers/render-page";
import { type Account, type AccountsWorld, buttonsOf, makeAccountsWorld } from "@/tests/helpers/staff-screens";

// Estado que las simulaciones leen al ejecutarse: el mundo en memoria, la sesión y las llamadas a `redirect`.
const state = vi.hoisted(() => ({
  user: null as { member_id: string; role: string } | null,
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

const NEW_ACCOUNT_HREF = "/cuentas/nuevo";

let accounts: AccountsWorld;

/** Textos de los enlaces `<a>` hacia ese destino (sin confundir `<a>` con `<article>`). */
function linkTextsOf(html: string, href: string): string[] {
  const texts: string[] = [];
  for (const link of html.matchAll(/<a(\s[^>]*)?>([\s\S]*?)<\/a>/g)) {
    if (attributeOf(`<a${link[1] ?? ""}>`, "href") === href) {
      texts.push(textOf(link[2]));
    }
  }
  return texts;
}

beforeEach(() => {
  accounts = makeAccountsWorld();
  state.redirected = [];
  state.container = { members: accounts.world.members };
  state.user = null;
});

function screen(searchParams: SearchParams = {}): Promise<string> {
  return renderComplete(
    createElement(AccountsPage, { params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) }),
  );
}

async function signInAs(role: Role): Promise<Account> {
  const person = await accounts.addAccount(role, { name: "Yo Mismo" });
  state.user = person.actor;
  return person;
}

describe("F36 · /cuentas · botón «Nueva cuenta» (regla 12)", () => {
  it.each(["BIBLIOTECARIO", "ADMINISTRADOR"] as const)("%s ve «Nueva cuenta» hacia /cuentas/nuevo", async (role) => {
    await signInAs(role);

    const html = await screen();

    expect(linkTextsOf(html, NEW_ACCOUNT_HREF)).toEqual(["Nueva cuenta"]);
  });

  it("el botón mide al menos 44 px y es un enlace, no un <button>", async () => {
    await signInAs("BIBLIOTECARIO");

    const html = await screen();

    const link = openingTags(html, "a").find((tag) => attributeOf(tag, "href") === NEW_ACCOUNT_HREF) ?? "";
    expect(link).not.toBe("");
    expect(attributeOf(link, "class")).toContain("min-h-11");
    expect(buttonsOf(html).map((button) => button.text)).not.toContain("Nueva cuenta");
  });

  it("el botón va encima de la lista de cuentas", async () => {
    await accounts.addAccount("ESTUDIANTE", { name: "Ana Estudiante" });
    await signInAs("ADMINISTRADOR");

    const html = await screen();

    expect(html.indexOf(NEW_ACCOUNT_HREF)).toBeGreaterThan(-1);
    expect(html.indexOf(NEW_ACCOUNT_HREF)).toBeLessThan(html.indexOf("<article"));
  });

  it("el botón sale también con una sola cuenta (la del propio personal)", async () => {
    await signInAs("BIBLIOTECARIO");

    const html = await screen();

    expect(articlesOf(html)).toHaveLength(1);
    expect(linkTextsOf(html, NEW_ACCOUNT_HREF)).toEqual(["Nueva cuenta"]);
  });

  it.each(["EXTERNO", "ESTUDIANTE", "DOCENTE"] as const)("un %s no ve el botón ni el destino", async (role) => {
    await signInAs(role);

    const html = await screen();

    expect(html).toContain("Solo para el personal de la biblioteca.");
    expect(html).not.toContain("Nueva cuenta");
    expect(html).not.toContain(NEW_ACCOUNT_HREF);
  });

  it("sin sesión redirige a /login y no hay botón", async () => {
    const html = await screen();

    expect(new Set(state.redirected)).toEqual(new Set(["/login"]));
    expect(html).not.toContain("Nueva cuenta");
    expect(html).not.toContain(NEW_ACCOUNT_HREF);
  });

  it("en «No se encontró esa página» no hay botón", async () => {
    await signInAs("BIBLIOTECARIO");

    const html = await screen({ after: "desconocido" });

    expect(html).toMatch(/role="alert"[^>]*>\s*No se encontró esa página\. Vuelve al inicio\.\s*<\/p>/);
    expect(html).not.toContain("Nueva cuenta");
    expect(html).not.toContain(NEW_ACCOUNT_HREF);
  });

  it("no hay botón en «No se encontró esa página» ni para el administrador", async () => {
    await signInAs("ADMINISTRADOR");

    const html = await screen({ after: "otro-inexistente" });

    expect(html).not.toContain(NEW_ACCOUNT_HREF);
  });
});

describe("F36 · /cuentas · lista y paginación no cambian (regla 12)", () => {
  async function fiftyOneAccounts(): Promise<{ people: Account[]; actor: Account }> {
    const people: Account[] = [];
    for (let index = 0; index < 50; index += 1) {
      people.push(await accounts.addAccount("ESTUDIANTE", { name: `Persona ${String(index).padStart(3, "0")}` }));
    }
    const actor = await accounts.addAccount("BIBLIOTECARIO", { name: "Zeta Actor" });
    return { people, actor };
  }

  it("51 cuentas: la primera página sigue con 50 tarjetas, sus botones y «Siguiente»", async () => {
    const { people, actor } = await fiftyOneAccounts();
    state.user = actor.actor;

    const html = await screen();

    expect(articlesOf(html)).toHaveLength(50);
    expect(buttonsOf(html)).toHaveLength(50);
    expect(linkTextsOf(html, `/cuentas?after=${people[49].id}`)).toEqual(["Siguiente"]);
    expect(linkTextsOf(html, NEW_ACCOUNT_HREF)).toEqual(["Nueva cuenta"]);
  });

  it("la segunda página sigue con la cuenta restante y «Volver al inicio», y también lleva el botón", async () => {
    const { people, actor } = await fiftyOneAccounts();
    state.user = actor.actor;

    const html = await screen({ after: people[49].id });

    expect(articlesOf(html)).toHaveLength(1);
    expect(html).toContain("Volver al inicio");
    expect(html).not.toContain("Siguiente");
    expect(linkTextsOf(html, NEW_ACCOUNT_HREF)).toEqual(["Nueva cuenta"]);
  });

  it("los botones de desactivar siguen igual: el bibliotecario solo sobre prestatarios", async () => {
    await accounts.addAccount("EXTERNO", { name: "Eva Externa" });
    await accounts.addAccount("BIBLIOTECARIO", { name: "Otro Bibliotecario" });
    await signInAs("BIBLIOTECARIO");

    const html = await screen();

    expect(buttonsOf(html).map((button) => button.text)).toEqual(["Desactivar"]);
  });

  it("el único enlace nuevo es «Nueva cuenta» (sin paginación en una página corta)", async () => {
    await accounts.addAccount("EXTERNO", { name: "Eva Externa" });
    await signInAs("ADMINISTRADOR");

    const html = await screen();

    expect(openingTags(html, "a").map((tag) => attributeOf(tag, "href"))).toEqual([NEW_ACCOUNT_HREF]);
  });

  it("ningún <div> ni <span> lleva texto de datos, tampoco con el botón", async () => {
    await accounts.addAccount("EXTERNO", { name: "Eva Externa" });
    await signInAs("ADMINISTRADOR");

    const html = await screen();

    expect(textOwners(html).filter((owner) => owner.tag === "div" || owner.tag === "span")).toEqual([]);
  });
});
