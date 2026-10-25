import { describe, expect, it } from "vitest";
import { CreateMemberInputSchema } from "../schema";
import {
  createdMemberMessage,
  MEMBER_DEFAULT_ERROR,
  MEMBER_DUPLICATE_ERROR,
  MEMBER_INVALID_DATA_ERROR,
  MEMBER_SESSION_ENDED_ERROR,
  MemberRequestError,
  messageForMemberError,
} from "../ui/member-form";
import { emailOfLength } from "@/tests/helpers/staff";

/** Lo que valida el formulario antes de enviar: el contrato de F3. */
function validate(over: { name?: string; email?: string; password?: string; role?: string } = {}) {
  return CreateMemberInputSchema.safeParse({
    name: "Ana Gómez",
    email: "ana@example.com",
    password: "clave-segura-123",
    role: "EXTERNO",
    ...over,
  });
}

function failedFields(result: ReturnType<typeof validate>): string[] {
  return (result.error?.issues ?? []).map((issue) => String(issue.path[0]));
}

describe("F36 · nombre según el contrato (regla 9)", () => {
  it.each([
    ["0 caracteres", "", false],
    ["1 carácter", "A", true],
    ["120 caracteres", "a".repeat(120), true],
    ["121 caracteres", "a".repeat(121), false],
    ["solo espacios", "     ", false],
  ])("nombre de %s → válido: %s", (_nombre, name, expected) => {
    expect(validate({ name }).success).toBe(expected);
  });

  it("el nombre se recorta", () => {
    expect(validate({ name: "  Ana Gómez  " }).data?.name).toBe("Ana Gómez");
  });

  it("un nombre inválido señala el campo name", () => {
    expect(failedFields(validate({ name: "" }))).toEqual(["name"]);
  });
});

describe("F36 · correo según el contrato (regla 9)", () => {
  it("con mayúsculas y espacios alrededor se normaliza a minúsculas y sin espacios", () => {
    const parsed = validate({ email: "  ANA@Example.COM  " });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.email).toBe("ana@example.com");
  });

  it("un correo de 254 caracteres es válido y uno de 255, no", () => {
    expect(emailOfLength(254)).toHaveLength(254);
    expect(emailOfLength(255)).toHaveLength(255);
    expect(validate({ email: emailOfLength(254) }).success).toBe(true);
    expect(validate({ email: emailOfLength(255) }).success).toBe(false);
  });

  it.each([
    "",
    "ana",
    "ana@",
    "@example.com",
    "ana example@x.com",
    "ana@@example.com",
  ])("«%s» no es un correo válido", (email) => {
    const parsed = validate({ email });
    expect(parsed.success).toBe(false);
    expect(failedFields(parsed)).toEqual(["email"]);
  });
});

describe("F36 · contraseña según el contrato (regla 9)", () => {
  it.each([
    [0, false],
    [7, false],
    [8, true],
    [9, true],
    [100, true],
    [101, false],
  ])("contraseña de %s caracteres → válida: %s", (length, expected) => {
    expect(validate({ password: "a".repeat(length) }).success).toBe(expected);
  });

  it("una contraseña inválida señala el campo password", () => {
    expect(failedFields(validate({ password: "a".repeat(7) }))).toEqual(["password"]);
  });

  it("la contraseña no se recorta: ocho espacios son ocho caracteres", () => {
    expect(validate({ password: " ".repeat(8) }).success).toBe(true);
  });
});

describe("F36 · tipo de cuenta según el contrato (regla 8)", () => {
  it.each(["EXTERNO", "ESTUDIANTE"])("%s es válido", (role) => {
    expect(validate({ role }).data?.role).toBe(role);
  });

  it.each(["DOCENTE", "BIBLIOTECARIO", "ADMINISTRADOR", "externo", ""])("«%s» se rechaza", (role) => {
    const parsed = validate({ role });
    expect(parsed.success).toBe(false);
    expect(failedFields(parsed)).toEqual(["role"]);
  });
});

describe("F36 · createdMemberMessage (regla 10)", () => {
  it("dice quién es la cuenta y que se entregan el correo y la contraseña", () => {
    expect(createdMemberMessage("Ana Gómez")).toBe(
      "Se creó la cuenta de Ana Gómez. Entrégale el correo y la contraseña; puede cambiarla después.",
    );
  });

  it("no interpreta el nombre (React lo escapa al pintarlo)", () => {
    expect(createdMemberMessage("<b>Ana</b>")).toContain("<b>Ana</b>");
  });
});

describe("F36 · messageForMemberError (regla 10)", () => {
  it("las constantes son los textos de la especificación", () => {
    expect(MEMBER_DUPLICATE_ERROR).toBe("Ya existe una cuenta con ese correo.");
    expect(MEMBER_INVALID_DATA_ERROR).toBe("Revisa los datos del formulario.");
    expect(MEMBER_SESSION_ENDED_ERROR).toBe("Tu sesión terminó. Vuelve a ingresar.");
    expect(MEMBER_DEFAULT_ERROR).toBe("No se pudo crear la cuenta");
  });

  it("409 → «Ya existe una cuenta con ese correo.»", () => {
    expect(messageForMemberError(new MemberRequestError(409, "otro texto"))).toBe(
      "Ya existe una cuenta con ese correo.",
    );
  });

  it("400 → «Revisa los datos del formulario.»", () => {
    expect(messageForMemberError(new MemberRequestError(400, "Datos inválidos"))).toBe(
      "Revisa los datos del formulario.",
    );
  });

  it.each([401, 403])("%s → «Tu sesión terminó. Vuelve a ingresar.»", (status) => {
    expect(messageForMemberError(new MemberRequestError(status, "Prohibido"))).toBe(
      "Tu sesión terminó. Vuelve a ingresar.",
    );
  });

  it.each([404, 429, 500, 503])("el estado %s muestra el mensaje del servidor", (status) => {
    expect(messageForMemberError(new MemberRequestError(status, "Mensaje del servidor"))).toBe("Mensaje del servidor");
  });

  it("un error de red (TypeError de fetch) → «No se pudo crear la cuenta»", () => {
    expect(messageForMemberError(new TypeError("Failed to fetch"))).toBe("No se pudo crear la cuenta");
  });

  it.each([
    ["un Error cualquiera", new Error("algo")],
    ["un texto", "409"],
    ["null", null],
    ["undefined", undefined],
    ["un número", 409],
    ["un objeto con estado 409 que no es MemberRequestError", { status: 409, message: "x" }],
  ])("%s no es un error del servidor → «No se pudo crear la cuenta»", (_nombre, value) => {
    expect(messageForMemberError(value)).toBe("No se pudo crear la cuenta");
  });

  it("MemberRequestError conserva estado y mensaje", () => {
    const error = new MemberRequestError(409, "x");
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(409);
    expect(error.message).toBe("x");
  });
});
