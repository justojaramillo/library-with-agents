import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { makeWorld, aMember } from "@/tests/helpers/factories";
import { createMemberService } from "../server/member-service";
import { describeLoggedError } from "@/shared/server/security/error-log";
import type { MemberRepository } from "../server/repository";

vi.mock("server-only", () => ({}));

/** S1 reglas 2 y 15: el log lleva nombre, `code` (si es texto) y mensaje recortado a 200; nunca pila ni propiedades. */
class CustomFailure extends Error {
  override name = "CustomFailure";
  token = "TOKEN-SECRETO";
  code: string | number = "";
}

function failure(message: string, code?: string | number): CustomFailure {
  const error = new CustomFailure(message);
  if (code !== undefined) {
    error.code = code;
  }
  return error;
}

describe("describeLoggedError · qué se escribe en el log", () => {
  it("lleva el nombre del error y su mensaje", () => {
    const text = describeLoggedError(new TypeError("algo salió mal"));

    expect(text).toContain("TypeError");
    expect(text).toContain("algo salió mal");
  });

  it("incluye el code cuando es texto", () => {
    const text = describeLoggedError(failure("falló", "auth/internal-error"));

    expect(text).toContain("CustomFailure");
    expect(text).toContain("auth/internal-error");
    expect(text).toContain("falló");
  });

  it("no incluye el code cuando es numérico", () => {
    const text = describeLoggedError(failure("falló", 12345));

    expect(text).not.toContain("12345");
    expect(text).toContain("falló");
  });

  it("un error sin code no muestra «undefined»", () => {
    expect(describeLoggedError(new Error("hola"))).not.toContain("undefined");
  });

  it("un mensaje de exactamente 200 caracteres se conserva entero", () => {
    const text = describeLoggedError(new Error("m".repeat(200)));

    expect(text).toContain("m".repeat(200));
  });

  it("un mensaje de 201 caracteres se recorta a 200", () => {
    const text = describeLoggedError(new Error("m".repeat(201)));

    expect(text).toContain("m".repeat(200));
    expect(text).not.toContain("m".repeat(201));
  });

  it("un mensaje larguísimo no llena el log", () => {
    expect(describeLoggedError(new Error("m".repeat(100_000))).length).toBeLessThan(400);
  });

  it("no lleva la pila ni las propiedades del error", () => {
    const text = describeLoggedError(failure("falló", "algun-codigo"));

    expect(text).not.toContain("TOKEN-SECRETO");
    expect(text).not.toMatch(/\n\s+at /);
    expect(text).not.toContain("describeLoggedError");
    expect(text).not.toContain("token");
  });

  it.each([
    ["un texto", "boom con datos"],
    ["un objeto", { password: "CLAVE-SECRETA" }],
    ["null", null],
    ["un número", 42],
  ])("lo que no es un Error (%s) no se vuelca al log", (_name, value) => {
    const text = describeLoggedError(value);

    expect(text).not.toContain("CLAVE-SECRETA");
    expect(text).not.toContain("boom con datos");
  });
});

/** Error de índice faltante de Firestore: el enlace para crearlo se conserva entero en el log. */
const CONSOLE_PREFIX = "https://console.firebase.google.com/";
const INDEX_TEXT = "9 FAILED_PRECONDITION: The query requires an index. You can create it here: ";
const INDEX_LINK = `${CONSOLE_PREFIX}v1/r/project/p/firestore/indexes?create_composite=${"Q1w2".repeat(100)}`;
const LINK_LABEL = " | enlace del índice: ";

describe("describeLoggedError · enlace para crear el índice que falta", () => {
  it("un error de Firestore con «requires an index» lleva el enlace entero al final", () => {
    const message = `${INDEX_TEXT}${INDEX_LINK}`;

    const text = describeLoggedError(new Error(message));

    expect(text).toContain(INDEX_LINK);
    expect(text.endsWith(`${message.slice(0, 200)}${LINK_LABEL}${INDEX_LINK}`)).toBe(true);
  });

  it("el mensaje sigue recortado a 200 caracteres y el resto del enlace solo aparece en el enlace añadido", () => {
    const message = `${INDEX_TEXT}${INDEX_LINK}`;

    const text = describeLoggedError(new Error(message));
    const beforeLink = text.slice(0, text.indexOf(LINK_LABEL));

    expect(beforeLink).toContain(message.slice(0, 200));
    expect(beforeLink).not.toContain(message.slice(0, 201));
    expect(text.split(INDEX_LINK).length).toBe(2);
  });

  it("un enlace de más de 2000 caracteres se recorta a 2000", () => {
    const longLink = `${CONSOLE_PREFIX}${"k".repeat(3000)}`;

    const text = describeLoggedError(new Error(`The query requires an index ${longLink}`));

    expect(text.endsWith(`${LINK_LABEL}${longLink.slice(0, 2000)}`)).toBe(true);
    expect(text).not.toContain(longLink.slice(0, 2001));
  });

  it("un enlace de exactamente 2000 caracteres se conserva entero", () => {
    const link = `${CONSOLE_PREFIX}${"k".repeat(2000 - CONSOLE_PREFIX.length)}`;

    const text = describeLoggedError(new Error(`The query requires an index ${link}`));

    expect(link.length).toBe(2000);
    expect(text.endsWith(`${LINK_LABEL}${link}`)).toBe(true);
  });

  it("el enlace llega hasta el primer espacio y no arrastra el texto que sigue", () => {
    const link = `${CONSOLE_PREFIX}v1/r/project/p/firestore/indexes?create_composite=abc`;

    const text = describeLoggedError(
      new Error(`The query requires an index. Create it: ${link} luego-reintente-la-consulta`),
    );

    expect(text.endsWith(`${LINK_LABEL}${link}`)).toBe(true);
    expect(text.split(LINK_LABEL)[1]).toBe(link);
  });

  it("si hay varios enlaces, añade solo el primero que empieza por la consola de Firebase", () => {
    const first = `${CONSOLE_PREFIX}primero`;
    const second = `${CONSOLE_PREFIX}segundo`;

    const text = describeLoggedError(
      new Error(`The query requires an index. https://ejemplo.com/otro ${first} ${second}`),
    );

    expect(text.split(LINK_LABEL)[1]).toBe(first);
    expect(text).not.toContain(LINK_LABEL + second);
  });

  it("con «requires an index» pero sin enlace, la salida es la de siempre", () => {
    const message = "The query requires an index. Pida a un administrador que lo cree.";

    const text = describeLoggedError(new Error(message));

    expect(text).toContain(message);
    expect(text).not.toContain("enlace del índice");
  });

  it("con «requires an index» y un enlace que no es de la consola de Firebase, no se añade", () => {
    const text = describeLoggedError(new Error("The query requires an index. Ver https://ejemplo.com/indices"));

    expect(text).not.toContain("enlace del índice");
  });

  it("con un enlace de la consola pero sin «requires an index», no se añade", () => {
    const message = `Permiso denegado. Revise ${CONSOLE_PREFIX}v1/r/project/p/firestore/rules`;

    const text = describeLoggedError(new Error(message));

    expect(text).toContain(message);
    expect(text).not.toContain("enlace del índice");
    expect(text.split(CONSOLE_PREFIX).length).toBe(2);
  });

  it("otros mensajes largos siguen recortados a 200 caracteres", () => {
    const text = describeLoggedError(new Error("m".repeat(500)));

    expect(text).toContain("m".repeat(200));
    expect(text).not.toContain("m".repeat(201));
    expect(text).not.toContain("enlace del índice");
  });

  it("el error de índice no lleva pila ni propiedades del error", () => {
    const error = failure(`${INDEX_TEXT}${INDEX_LINK}`, "failed-precondition");

    const text = describeLoggedError(error);

    expect(text).toContain("failed-precondition");
    expect(text).not.toContain("TOKEN-SECRETO");
    expect(text).not.toMatch(/\n\s+at /);
    expect(text).not.toContain("token");
  });

  it("lo que no es un Error se describe como «Error no estándar»", () => {
    expect(describeLoggedError("boom")).toContain("Error no estándar");
    expect(describeLoggedError({ message: `requires an index ${INDEX_LINK}` })).toContain("Error no estándar");
    expect(describeLoggedError({ message: `requires an index ${INDEX_LINK}` })).not.toContain(INDEX_LINK);
  });
});

describe("rollbackIdentity · la compensación registra con la descripción recortada", () => {
  let logSpy: MockInstance<Console["error"]>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  /** Repositorio que delega en el de memoria salvo `create`, que siempre falla. */
  function failingMembers(): MemberRepository {
    const inner = makeWorld().repos.members;
    return {
      create: async () => {
        throw new Error("no se pudo guardar la cuenta");
      },
      findById: (id) => inner.findById(id),
      findByEmail: (email) => inner.findByEmail(email),
      findByIds: (ids) => inner.findByIds(ids),
      existsWithRole: (role) => inner.existsWithRole(role),
      list: (limit, after) => inner.list(limit, after),
      search: (q, limit, lendable) => inner.search(q, limit, lendable),
      setActive: (id, active) => inner.setActive(id, active),
      listByRoles: (roles, limit) => inner.listByRoles(roles, limit),
    };
  }

  /** Servicio cuyo guardado de la cuenta falla y cuyo borrado de la identidad falla con `deleteError`. */
  function brokenService(deleteError: CustomFailure) {
    const identity = makeWorld().identity;
    return createMemberService({
      members: failingMembers(),
      identity: {
        createUser: (input) => identity.createUser(input),
        verifyIdToken: (token) => identity.verifyIdToken(token),
        createSessionCookie: (token, ttl) => identity.createSessionCookie(token, ttl),
        isEmailVerified: async () => false,
        deleteUser: async () => Promise.reject(deleteError),
      },
    });
  }

  const loggedText = () =>
    logSpy.mock.calls.map((call) => call.map((arg) => inspect(arg, { depth: 6 })).join(" ")).join("\n");

  it("si el borrado de la identidad falla, el alta sigue fallando con el error original", async () => {
    const service = brokenService(failure("no se pudo borrar"));

    await expect(service.register(aMember())).rejects.toThrow("no se pudo guardar la cuenta");
  });

  it("registra nombre, code y mensaje recortado, sin pila ni propiedades", async () => {
    const service = brokenService(failure("n".repeat(500), "auth/internal-error"));

    await expect(service.register(aMember())).rejects.toThrow();

    const text = loggedText();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(text).toContain("CustomFailure");
    expect(text).toContain("auth/internal-error");
    expect(text).toContain("n".repeat(200));
    expect(text).not.toContain("n".repeat(201));
    expect(text).not.toContain("TOKEN-SECRETO");
    expect(text).not.toMatch(/\n\s+at /);
  });

  it("si el borrado de la identidad funciona, no registra nada", async () => {
    const service = createMemberService({ members: failingMembers(), identity: makeWorld().identity });

    await expect(service.register(aMember())).rejects.toThrow();

    expect(logSpy).not.toHaveBeenCalled();
  });
});
