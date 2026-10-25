import { describe, expect, it, vi } from "vitest";
import { ROLES, type Role } from "@/shared/schema";
import { createSessionResolver } from "@/shared/server/security/session";

type Account = { role: Role; active: boolean };

/** Dobles mínimos: cookies válidas → uid, y uid → cuenta. Sin Firebase ni red. */
function makeResolver(cookies: Record<string, string>, accounts: Record<string, Account>) {
  const verifySessionCookie = vi.fn(async (cookie: string) => {
    const uid = cookies[cookie];
    if (uid === undefined) {
      return null;
    }
    return { uid };
  });
  const loadMember = vi.fn(async (uid: string) => accounts[uid]);
  return { resolve: createSessionResolver({ verifySessionCookie, loadMember }), verifySessionCookie, loadMember };
}

describe("F4 · sesión a partir de la cookie de Firebase", () => {
  it.each(ROLES)("una cookie válida de una cuenta activa %s devuelve member_id y ese rol", async (role) => {
    const { resolve } = makeResolver({ "cookie-ok": "uid-1" }, { "uid-1": { role, active: true } });
    expect(await resolve("cookie-ok")).toEqual({ member_id: "uid-1", role });
  });

  it("el rol sale de la cuenta vigente: si cambia el rol de la cuenta, cambia el de la sesión", async () => {
    const accounts: Record<string, Account> = { "uid-1": { role: "ESTUDIANTE", active: true } };
    const { resolve } = makeResolver({ "cookie-ok": "uid-1" }, accounts);
    expect(await resolve("cookie-ok")).toEqual({ member_id: "uid-1", role: "ESTUDIANTE" });
    accounts["uid-1"] = { role: "BIBLIOTECARIO", active: true };
    expect(await resolve("cookie-ok")).toEqual({ member_id: "uid-1", role: "BIBLIOTECARIO" });
  });

  it("devuelve solo member_id y role, nada más", async () => {
    const { resolve } = makeResolver({ "cookie-ok": "uid-1" }, { "uid-1": { role: "DOCENTE", active: true } });
    const session = await resolve("cookie-ok");
    expect(Object.keys(session ?? {}).sort()).toEqual(["member_id", "role"]);
  });

  it("sin cookie no hay sesión y ni siquiera se consulta a la identidad", async () => {
    const { resolve, verifySessionCookie, loadMember } = makeResolver({}, {});
    expect(await resolve(undefined)).toBeNull();
    expect(await resolve("")).toBeNull();
    expect(verifySessionCookie).not.toHaveBeenCalled();
    expect(loadMember).not.toHaveBeenCalled();
  });

  it("una cookie alterada, expirada o desconocida no da sesión y no consulta cuentas", async () => {
    const { resolve, loadMember } = makeResolver(
      { "cookie-ok": "uid-1" },
      { "uid-1": { role: "ADMINISTRADOR", active: true } },
    );
    expect(await resolve("cookie-ok-alterada")).toBeNull();
    expect(await resolve("cookie-expirada")).toBeNull();
    expect(loadMember).not.toHaveBeenCalled();
  });

  it("una cookie válida de una cuenta que ya no existe no da sesión", async () => {
    const { resolve } = makeResolver({ "cookie-ok": "uid-borrado" }, {});
    expect(await resolve("cookie-ok")).toBeNull();
  });

  it("una cookie válida de una cuenta inactiva no da sesión, sea cual sea su rol", async () => {
    for (const role of ROLES) {
      const { resolve } = makeResolver({ "cookie-ok": "uid-1" }, { "uid-1": { role, active: false } });
      expect(await resolve("cookie-ok")).toBeNull();
    }
  });

  it("una cuenta que se desactiva después de ingresar pierde la sesión en la siguiente petición", async () => {
    const accounts: Record<string, Account> = { "uid-1": { role: "ESTUDIANTE", active: true } };
    const { resolve } = makeResolver({ "cookie-ok": "uid-1" }, accounts);
    expect(await resolve("cookie-ok")).not.toBeNull();
    accounts["uid-1"] = { role: "ESTUDIANTE", active: false };
    expect(await resolve("cookie-ok")).toBeNull();
  });

  it("la cookie de una persona nunca da la identidad de otra", async () => {
    const { resolve } = makeResolver(
      { "cookie-a": "uid-a", "cookie-b": "uid-b" },
      { "uid-a": { role: "EXTERNO", active: true }, "uid-b": { role: "ADMINISTRADOR", active: true } },
    );
    expect(await resolve("cookie-a")).toEqual({ member_id: "uid-a", role: "EXTERNO" });
    expect(await resolve("cookie-b")).toEqual({ member_id: "uid-b", role: "ADMINISTRADOR" });
  });
});
