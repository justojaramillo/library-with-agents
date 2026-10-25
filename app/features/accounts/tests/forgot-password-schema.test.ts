import { describe, expect, it } from "vitest";
import { ForgotPasswordInputSchema } from "../schema";

/**
 * Correo válido de exactamente `length` caracteres: parte local de 64, dominio con etiquetas de máximo 63 y «.com».
 * Solo se usa para 254 y 255 (los bordes del máximo de un correo).
 */
function emailOfLength(length: number): string {
  const local = "a".repeat(64);
  const domainBody = length - local.length - 1 - ".com".length;
  let domain = "";
  for (let i = 0; i < domainBody; i += 1) {
    if (i % 64 === 63) {
      domain += ".";
    } else {
      domain += "b";
    }
  }
  return `${local}@${domain}.com`;
}

describe("F16 · ForgotPasswordInputSchema", () => {
  it("acepta un correo normal", () => {
    const parsed = ForgotPasswordInputSchema.safeParse({ email: "ana@example.com" });

    expect(parsed.success).toBe(true);
  });

  it("recorta los espacios alrededor", () => {
    expect(ForgotPasswordInputSchema.parse({ email: "   ana@example.com \t" }).email).toBe("ana@example.com");
  });

  it("pasa el correo a minúsculas", () => {
    expect(ForgotPasswordInputSchema.parse({ email: "ANA@Example.COM" }).email).toBe("ana@example.com");
  });

  it("recorta y pasa a minúsculas a la vez", () => {
    expect(ForgotPasswordInputSchema.parse({ email: "  Ana.Gomez@Example.Com  " }).email).toBe("ana.gomez@example.com");
  });

  it.each([
    ["vacío", ""],
    ["solo espacios", "     "],
    ["sin arroba", "ana.example.com"],
    ["sin dominio", "ana@"],
    ["sin parte local", "@example.com"],
    ["dominio sin punto", "ana@example"],
    ["con espacios en medio", "ana gomez@example.com"],
  ])("rechaza un correo %s", (_name, email) => {
    expect(ForgotPasswordInputSchema.safeParse({ email }).success).toBe(false);
  });

  it("rechaza un cuerpo sin el campo email", () => {
    expect(ForgotPasswordInputSchema.safeParse({}).success).toBe(false);
  });

  it("rechaza un email que no es texto", () => {
    expect(ForgotPasswordInputSchema.safeParse({ email: 42 }).success).toBe(false);
    expect(ForgotPasswordInputSchema.safeParse({ email: null }).success).toBe(false);
  });

  it("un correo de 254 caracteres (el máximo habitual) se acepta", () => {
    const email = emailOfLength(254);

    expect(email).toHaveLength(254);
    expect(ForgotPasswordInputSchema.safeParse({ email }).success).toBe(true);
  });

  it("un correo de 255 caracteres se rechaza", () => {
    const email = emailOfLength(255);

    expect(email).toHaveLength(255);
    expect(ForgotPasswordInputSchema.safeParse({ email }).success).toBe(false);
  });

  it("los espacios alrededor no cuentan para el máximo: 254 caracteres más espacios se acepta", () => {
    expect(ForgotPasswordInputSchema.safeParse({ email: `  ${emailOfLength(254)}  ` }).success).toBe(true);
  });
});
