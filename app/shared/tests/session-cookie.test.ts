import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionCookieName, sessionCookieOptions } from "@/shared/server/security/session";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Seguridad · nombre de la cookie de sesión", () => {
  it("en producción usa el prefijo __Host-", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(sessionCookieName()).toBe("__Host-session");
  });

  it("en desarrollo usa session (http no admite __Host-)", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(sessionCookieName()).toBe("session");
  });
});

describe("Seguridad · atributos de la cookie de sesión", () => {
  it("en producción es HttpOnly, Secure, SameSite=Lax, path=/ y con la vigencia recibida", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(sessionCookieOptions(3600)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 3600,
    });
  });

  it("en desarrollo no es Secure, pero conserva HttpOnly, SameSite=Lax y path=/", () => {
    vi.stubEnv("NODE_ENV", "development");
    const options = sessionCookieOptions(60);
    expect(options.secure).toBe(false);
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
    expect(options.maxAge).toBe(60);
  });

  it.each([0, 1, 28800])("conserva la vigencia recibida (%i s)", (seconds) => {
    expect(sessionCookieOptions(seconds).maxAge).toBe(seconds);
  });

  it.each(["production", "development"])("no define domain en %s (la cookie queda atada al host)", (env) => {
    vi.stubEnv("NODE_ENV", env);
    expect(sessionCookieOptions(100)).not.toHaveProperty("domain");
  });
});
