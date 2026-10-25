import { describe, expect, it } from "vitest";
import { checkSameOrigin, type SameOriginInput } from "@/shared/server/security/origin";

const APP = "https://biblioteca.example.com";

/** Petición base: POST JSON del mismo origen. Cada prueba cambia solo lo que le interesa. */
function input(changes: Partial<SameOriginInput> = {}): SameOriginInput {
  return {
    method: "POST",
    secFetchSite: "same-origin",
    origin: APP,
    requestOrigin: APP,
    contentType: "application/json",
    ...changes,
  };
}

describe("Seguridad · defensa CSRF por origen (Sec-Fetch-Site)", () => {
  it("acepta una petición JSON del mismo origen", () => {
    expect(checkSameOrigin(input())).toBe(true);
  });

  it("acepta la navegación directa del usuario (none)", () => {
    expect(checkSameOrigin(input({ secFetchSite: "none" }))).toBe(true);
  });

  it("rechaza same-site: otro subdominio no es el mismo origen", () => {
    expect(checkSameOrigin(input({ secFetchSite: "same-site" }))).toBe(false);
  });

  it("rechaza cross-site", () => {
    expect(checkSameOrigin(input({ secFetchSite: "cross-site" }))).toBe(false);
  });

  it("rechaza un valor desconocido de Sec-Fetch-Site", () => {
    expect(checkSameOrigin(input({ secFetchSite: "otro" }))).toBe(false);
  });

  it("Sec-Fetch-Site manda sobre Origin: cross-site se rechaza aunque Origin coincida", () => {
    expect(checkSameOrigin(input({ secFetchSite: "cross-site", origin: APP }))).toBe(false);
  });

  it("Sec-Fetch-Site manda sobre Origin: same-origin pasa aunque Origin no coincida", () => {
    expect(checkSameOrigin(input({ secFetchSite: "same-origin", origin: "https://evil.example" }))).toBe(true);
  });
});

describe("Seguridad · defensa CSRF por Origin cuando falta Sec-Fetch-Site", () => {
  it("acepta si Origin coincide con el origen de la petición", () => {
    expect(checkSameOrigin(input({ secFetchSite: null }))).toBe(true);
  });

  it("rechaza si Origin es de otro sitio", () => {
    expect(checkSameOrigin(input({ secFetchSite: null, origin: "https://evil.example" }))).toBe(false);
  });

  it("rechaza un Origin que solo se parece (otro puerto o esquema)", () => {
    expect(checkSameOrigin(input({ secFetchSite: null, origin: "http://biblioteca.example.com" }))).toBe(false);
    expect(checkSameOrigin(input({ secFetchSite: null, origin: `${APP}:8443` }))).toBe(false);
  });
});

describe("Seguridad · peticiones sin cabeceras de origen", () => {
  it.each(["GET", "HEAD", "OPTIONS"])("%s sin cabeceras pasa (método seguro)", (method) => {
    expect(checkSameOrigin(input({ method, secFetchSite: null, origin: null, contentType: null }))).toBe(true);
  });

  it("acepta métodos seguros en minúsculas", () => {
    expect(checkSameOrigin(input({ method: "get", secFetchSite: null, origin: null, contentType: null }))).toBe(true);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("%s sin cabeceras se rechaza", (method) => {
    expect(checkSameOrigin(input({ method, secFetchSite: null, origin: null }))).toBe(false);
  });
});

describe("Seguridad · Content-Type del cuerpo", () => {
  it("sin cuerpo (null) pasa", () => {
    expect(checkSameOrigin(input({ contentType: null }))).toBe(true);
  });

  it("cuerpo sin Content-Type (cadena vacía) se rechaza", () => {
    expect(checkSameOrigin(input({ contentType: "" }))).toBe(false);
  });

  it("application/json pasa", () => {
    expect(checkSameOrigin(input({ contentType: "application/json" }))).toBe(true);
  });

  it("application/json con charset pasa", () => {
    expect(checkSameOrigin(input({ contentType: "application/json; charset=utf-8" }))).toBe(true);
  });

  it("text/plain se rechaza", () => {
    expect(checkSameOrigin(input({ contentType: "text/plain" }))).toBe(false);
  });

  it("application/x-www-form-urlencoded se rechaza", () => {
    expect(checkSameOrigin(input({ contentType: "application/x-www-form-urlencoded" }))).toBe(false);
  });

  it("multipart/form-data se rechaza", () => {
    expect(checkSameOrigin(input({ contentType: "multipart/form-data; boundary=x" }))).toBe(false);
  });

  it("un tipo que solo contiene la palabra json no pasa", () => {
    expect(checkSameOrigin(input({ contentType: "text/json" }))).toBe(false);
    expect(checkSameOrigin(input({ contentType: "application/jsonp" }))).toBe(false);
  });
});

describe("Seguridad · ataque de login CSRF", () => {
  it("un formulario de otro sitio con text/plain hacia el login se rechaza", () => {
    const attack = input({
      method: "POST",
      secFetchSite: "cross-site",
      origin: "https://evil.example",
      contentType: "text/plain",
    });
    expect(checkSameOrigin(attack)).toBe(false);
  });

  it("el mismo formulario de un navegador viejo (sin Sec-Fetch-Site) también se rechaza", () => {
    const attack = input({
      secFetchSite: null,
      origin: "https://evil.example",
      contentType: "text/plain",
    });
    expect(checkSameOrigin(attack)).toBe(false);
  });

  it("con Origin correcto pero text/plain sigue rechazado", () => {
    expect(checkSameOrigin(input({ secFetchSite: null, contentType: "text/plain" }))).toBe(false);
  });
});
