import { describe, expect, it } from "vitest";
import { ChangePasswordInputSchema } from "../schema";

const MUST_DIFFER = "La nueva contraseña debe ser distinta de la actual.";
const CURRENT = "clave-actual-123";

/** Entrada válida salvo lo que se sobreescriba. */
function input(over: { current_password?: string; new_password?: string } = {}) {
  return { current_password: CURRENT, new_password: "clave-nueva-456", ...over };
}

/** Campos en los que el esquema encontró problemas, sin repetidos. */
function failingFields(over: { current_password?: string; new_password?: string }): string[] {
  const parsed = ChangePasswordInputSchema.safeParse(input(over));
  if (parsed.success) {
    return [];
  }
  return [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
}

describe("F15 · ChangePasswordInputSchema · caso feliz (regla 3)", () => {
  it("acepta una actual y una nueva válidas y distintas", () => {
    const parsed = ChangePasswordInputSchema.safeParse(input());

    expect(parsed.success).toBe(true);
  });

  it("devuelve ambos valores tal cual, sin transformarlos", () => {
    expect(ChangePasswordInputSchema.parse(input())).toEqual({
      current_password: CURRENT,
      new_password: "clave-nueva-456",
    });
  });
});

describe("F15 · ChangePasswordInputSchema · contraseña actual (1 a 100)", () => {
  it("rechaza una actual vacía y señala el campo current_password", () => {
    expect(failingFields({ current_password: "" })).toEqual(["current_password"]);
  });

  it("acepta una actual de 1 carácter", () => {
    expect(ChangePasswordInputSchema.safeParse(input({ current_password: "a" })).success).toBe(true);
  });

  it("acepta una actual de 100 caracteres", () => {
    expect(ChangePasswordInputSchema.safeParse(input({ current_password: "a".repeat(100) })).success).toBe(true);
  });

  it("rechaza una actual de 101 caracteres", () => {
    expect(failingFields({ current_password: "a".repeat(101) })).toEqual(["current_password"]);
  });

  it("rechaza un cuerpo sin la actual", () => {
    expect(ChangePasswordInputSchema.safeParse({ new_password: "clave-nueva-456" }).success).toBe(false);
  });

  it("rechaza una actual que no es texto", () => {
    expect(
      ChangePasswordInputSchema.safeParse({ current_password: 12345678, new_password: "clave-nueva-456" }).success,
    ).toBe(false);
    expect(
      ChangePasswordInputSchema.safeParse({ current_password: null, new_password: "clave-nueva-456" }).success,
    ).toBe(false);
  });
});

describe("F15 · ChangePasswordInputSchema · contraseña nueva (8 a 100)", () => {
  it.each([
    ["0 caracteres", ""],
    ["7 caracteres", "abcdefg"],
    ["101 caracteres", "a".repeat(101)],
  ])("rechaza una nueva de %s y señala new_password", (_name, value) => {
    expect(failingFields({ new_password: value })).toEqual(["new_password"]);
  });

  it.each([
    ["8 caracteres", "abcdefgh"],
    ["9 caracteres", "abcdefghi"],
    ["99 caracteres", "a".repeat(99)],
    ["100 caracteres", "a".repeat(100)],
  ])("acepta una nueva de %s", (_name, value) => {
    expect(ChangePasswordInputSchema.safeParse(input({ new_password: value })).success).toBe(true);
  });

  it("rechaza un cuerpo sin la nueva", () => {
    expect(ChangePasswordInputSchema.safeParse({ current_password: CURRENT }).success).toBe(false);
  });

  it("rechaza una nueva que no es texto", () => {
    expect(ChangePasswordInputSchema.safeParse({ current_password: CURRENT, new_password: 123456789 }).success).toBe(
      false,
    );
    expect(ChangePasswordInputSchema.safeParse({ current_password: CURRENT, new_password: null }).success).toBe(false);
  });

  it("cuenta los caracteres de 7 letras con tilde como 7 (no llega a 8)", () => {
    expect(failingFields({ new_password: "ñandúes" })).toEqual(["new_password"]);
  });
});

describe("F15 · ChangePasswordInputSchema · los espacios no se recortan (borde)", () => {
  it("conserva los espacios al inicio y al final de la nueva", () => {
    const parsed = ChangePasswordInputSchema.parse(input({ new_password: "  clave nueva  " }));

    expect(parsed.new_password).toBe("  clave nueva  ");
  });

  it("conserva los espacios al inicio y al final de la actual", () => {
    const parsed = ChangePasswordInputSchema.parse(input({ current_password: " clave actual " }));

    expect(parsed.current_password).toBe(" clave actual ");
  });

  it("una nueva de 7 letras más un espacio mide 8 y se acepta", () => {
    expect(ChangePasswordInputSchema.safeParse(input({ new_password: "abcdefg " })).success).toBe(true);
  });

  it("una nueva de 8 espacios se acepta: no se recorta hasta dejarla vacía", () => {
    expect(ChangePasswordInputSchema.safeParse(input({ new_password: "        " })).success).toBe(true);
  });

  it("la nueva con un espacio de más ya no es igual a la actual", () => {
    expect(
      ChangePasswordInputSchema.safeParse({ current_password: "clave-segura-1", new_password: "clave-segura-1 " })
        .success,
    ).toBe(true);
    expect(
      ChangePasswordInputSchema.safeParse({ current_password: " clave-segura-1", new_password: "clave-segura-1" })
        .success,
    ).toBe(true);
  });
});

describe("F15 · ChangePasswordInputSchema · la nueva debe ser distinta de la actual (regla 3)", () => {
  it("rechaza una nueva igual a la actual con el mensaje exacto en new_password", () => {
    const parsed = ChangePasswordInputSchema.safeParse({
      current_password: "misma-clave-1",
      new_password: "misma-clave-1",
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      return;
    }
    expect(parsed.error.issues).toHaveLength(1);
    expect(parsed.error.issues[0].message).toBe(MUST_DIFFER);
    expect(parsed.error.issues[0].path).toEqual(["new_password"]);
  });

  it("igual a la actual con 8 caracteres exactos también se rechaza", () => {
    const parsed = ChangePasswordInputSchema.safeParse({ current_password: "abcdefgh", new_password: "abcdefgh" });

    expect(parsed.success).toBe(false);
  });

  it("igual a la actual con 100 caracteres también se rechaza", () => {
    const same = "x".repeat(100);

    expect(ChangePasswordInputSchema.safeParse({ current_password: same, new_password: same }).success).toBe(false);
  });

  it("con una sola mayúscula distinta es válida: las contraseñas distinguen mayúsculas", () => {
    expect(
      ChangePasswordInputSchema.safeParse({ current_password: "Clave-segura-1", new_password: "clave-segura-1" })
        .success,
    ).toBe(true);
  });

  it("con un solo carácter distinto al final es válida", () => {
    expect(
      ChangePasswordInputSchema.safeParse({ current_password: "clave-segura-1", new_password: "clave-segura-2" })
        .success,
    ).toBe(true);
  });

  it("una nueva demasiado corta no añade además el mensaje de «distinta» si sí lo es", () => {
    const parsed = ChangePasswordInputSchema.safeParse({ current_password: "otra-clave-9", new_password: "corta" });

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      return;
    }
    expect(parsed.error.issues.map((issue) => issue.message)).not.toContain(MUST_DIFFER);
  });
});
