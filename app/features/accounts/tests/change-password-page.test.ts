import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChangePasswordPage from "@/contrasena/page";
import { ROLES, type Role } from "@/shared/schema";
import { aProvisionedMember, makeWorld, type World } from "@/tests/helpers/factories";
import { attributeOf, fieldLabelled, openingTags, textOf } from "@/tests/helpers/html";
import { renderComplete } from "@/tests/helpers/render-page";

type SessionState = { member_id: string; role: Role };

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

let world: World;

beforeEach(() => {
  world = makeWorld();
  state.redirected = [];
  state.container = { members: world.members };
  state.user = null;
});

/** Crea la cuenta con ese rol y deja su sesión abierta. */
async function signInAs(role: Role, name = "Ana Pérez"): Promise<{ id: string; email: string; session: SessionState }> {
  const created = await world.members.provision(aProvisionedMember({ role, name }));
  const session: SessionState = { member_id: created.id, role };
  state.user = session;
  return { id: created.id, email: created.email, session };
}

function screen(): Promise<string> {
  return renderComplete(createElement(ChangePasswordPage));
}

function headingsOf(html: string): string[] {
  return (html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/g) ?? []).map(textOf);
}

describe("F15 · /contrasena · marco estático (regla 1)", () => {
  const html = renderToStaticMarkup(createElement(ChangePasswordPage));

  it("tiene un único <h1> «Cambiar contraseña» que nombra la sección", () => {
    expect(headingsOf(html)).toEqual(["Cambiar contraseña"]);
    const section = openingTags(html, "section")[0];
    expect(attributeOf(section, "aria-labelledby")).toBe(attributeOf(openingTags(html, "h1")[0], "id"));
  });

  it("mientras lee la sesión anuncia que carga y no pinta el formulario ni el correo", () => {
    expect(html).toContain("Cargando");
    expect(html).toContain('role="status"');
    expect(html).not.toMatch(/<form\b/);
    expect(html).not.toMatch(/<input\b/);
    expect(html).not.toContain("Cuenta:");
  });
});

describe("F15 · /contrasena · sin sesión (regla 1 y criterio de aceptación)", () => {
  it("un visitante sin sesión va a /login y no ve el formulario", async () => {
    state.user = null;

    const html = await screen();

    // React puede reintentar el render de la parte dinámica tras el redirect: lo que importa es el destino.
    expect(state.redirected.length).toBeGreaterThan(0);
    expect(new Set(state.redirected)).toEqual(new Set(["/login"]));
    expect(html).not.toMatch(/<form\b/);
    expect(html).not.toMatch(/<input\b/);
    expect(html).not.toContain("Cuenta:");
  });

  it("una sesión cuya cuenta ya no existe va a /login y no ve el formulario", async () => {
    state.user = { member_id: "uid-borrado", role: "ESTUDIANTE" };

    const html = await screen();

    expect(new Set(state.redirected)).toEqual(new Set(["/login"]));
    expect(html).not.toMatch(/<form\b/);
  });

  it("no consulta ninguna cuenta si no hay sesión", async () => {
    const getSpy = vi.spyOn(world.members, "get");
    state.user = null;

    await screen();

    expect(getSpy).not.toHaveBeenCalled();
  });
});

describe("F15 · /contrasena · con sesión, los cinco roles (autorización)", () => {
  it.each(ROLES)("un %s ve el título, su correo como texto y el formulario", async (role) => {
    const account = await signInAs(role);

    const html = await screen();

    expect(state.redirected).toEqual([]);
    expect(headingsOf(html)).toEqual(["Cambiar contraseña"]);
    const info = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((match) => textOf(match[1]));
    expect(info).toContain(`Cuenta: ${account.email}`);
    expect(html).toMatch(/<form\b/);
    expect(fieldLabelled(html, "Contraseña actual")).not.toBeNull();
    expect(fieldLabelled(html, "Nueva contraseña")).not.toBeNull();
    expect(fieldLabelled(html, "Confirmar nueva contraseña")).not.toBeNull();
    expect(html).toContain("Entre 8 y 100 caracteres");
  });

  it("el correo del texto es el de la cuenta de la sesión, no el de otra persona", async () => {
    const other = await world.members.provision(aProvisionedMember({ role: "DOCENTE", name: "Otra Persona" }));
    const mine = await signInAs("ESTUDIANTE");

    const html = await screen();

    expect(html).toContain(mine.email);
    expect(html).not.toContain(other.email);
    expect(html).not.toContain("Otra Persona");
  });

  it("lee la cuenta con el identificador de la sesión (nunca de la petición)", async () => {
    const getSpy = vi.spyOn(world.members, "get");
    const account = await signInAs("BIBLIOTECARIO");

    await screen();

    expect(getSpy).toHaveBeenCalled();
    for (const call of getSpy.mock.calls) {
      expect(call[0]).toBe(account.id);
    }
  });

  it("el correo no se ofrece como campo editable", async () => {
    await signInAs("ADMINISTRADOR");

    const html = await screen();

    expect(html).not.toContain('type="email"');
    expect(html).not.toContain('type="text"');
    expect(openingTags(html, "input")).toHaveLength(3);
  });
});

describe("F15 · /contrasena · contenido seguro", () => {
  it("la página no trae ninguna contraseña: los campos salen vacíos y sin valor", async () => {
    const account = await signInAs("EXTERNO");

    const html = await screen();

    for (const input of openingTags(html, "input")) {
      expect(attributeOf(input, "type")).toBe("password");
      expect(input).not.toMatch(/\svalue=/);
    }
    expect(html).not.toContain("clave-segura-123");
    expect(html).toContain(account.email);
  });

  it("no pinta mensajes de error ni de estado al abrir", async () => {
    await signInAs("DOCENTE");

    const html = await screen();

    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("Tu contraseña se cambió");
  });

  it("el correo se escapa: un correo con marcado no sale como HTML", async () => {
    const account = await signInAs("ESTUDIANTE");
    vi.spyOn(world.members, "get").mockResolvedValue({
      id: account.id,
      name: "Ana Pérez",
      email: "<b>x</b>@example.com",
      role: "ESTUDIANTE",
      active: true,
    });

    const html = await screen();

    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;@example.com");
  });
});
