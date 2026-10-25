import { describe, expect, it } from "vitest";
import { createMemoryIdentityProvider } from "../server/identity.memory";

async function newUser(identity = createMemoryIdentityProvider()) {
  const { uid } = await identity.createUser({ email: "ana@example.com", password: "clave-segura-123", name: "Ana" });
  return { identity, uid };
}

describe("F11 · IdentityProvider.isEmailVerified (identidad en memoria)", () => {
  it("una cuenta recién creada no tiene el correo verificado", async () => {
    const { identity, uid } = await newUser();

    expect(await identity.isEmailVerified(uid)).toBe(false);
  });

  it("al pulsar el enlace de verificación pasa a verdadero, en la siguiente lectura", async () => {
    const { identity, uid } = await newUser();

    identity.markEmailVerified(uid);

    expect(await identity.isEmailVerified(uid)).toBe(true);
  });

  it("si el correo vuelve a quedar sin verificar, la lectura lo refleja", async () => {
    const { identity, uid } = await newUser();
    identity.markEmailVerified(uid);

    identity.markEmailUnverified(uid);

    expect(await identity.isEmailVerified(uid)).toBe(false);
  });

  it("un uid que no existe cuenta como no verificado", async () => {
    const identity = createMemoryIdentityProvider();

    expect(await identity.isEmailVerified("uid-fantasma")).toBe(false);
  });

  it("marcar un uid que no existe no lo hace verificado", async () => {
    const identity = createMemoryIdentityProvider();

    identity.markEmailVerified("uid-fantasma");

    expect(await identity.isEmailVerified("uid-fantasma")).toBe(false);
  });

  it("al borrar la identidad deja de estar verificada", async () => {
    const { identity, uid } = await newUser();
    identity.markEmailVerified(uid);

    await identity.deleteUser(uid);

    expect(await identity.isEmailVerified(uid)).toBe(false);
  });

  it("la verificación de una cuenta no afecta a otra", async () => {
    const { identity, uid } = await newUser();
    const other = await identity.createUser({ email: "beto@example.com", password: "clave-segura-123", name: "Beto" });

    identity.markEmailVerified(uid);

    expect(await identity.isEmailVerified(other.uid)).toBe(false);
  });
});
