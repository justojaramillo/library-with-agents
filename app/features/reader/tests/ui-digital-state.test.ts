import { describe, expect, it } from "vitest";
import { DIGITAL_RULES } from "../schema";
import {
  COPIES_INVALID_ERROR,
  DIGITAL_DEFAULT_ERROR,
  DIGITAL_RATE_LIMIT_ERROR,
  DIGITAL_SESSION_ENDED_ERROR,
  DigitalRequestError,
  FILE_EMPTY_ERROR,
  FILE_TOO_BIG_ERROR,
  describeDigitalState,
  formatKilobytes,
  isAllowedFileName,
  messageForDigitalError,
  parseDigitalCopies,
  savedCopiesMessage,
  uploadedContentMessage,
  utf8ByteLength,
  validateMarkdownFile,
} from "../ui/digital-state";
import { anInfo, anInfoWithContent } from "./ui-fixtures";

describe("F27 · UI · textos fijos de la regla 14", () => {
  it("los mensajes de error son los de la especificación", () => {
    expect(FILE_EMPTY_ERROR).toBe("El archivo está vacío.");
    expect(FILE_TOO_BIG_ERROR).toBe("El archivo supera los 2 MB.");
    expect(DIGITAL_RATE_LIMIT_ERROR).toBe("Demasiadas cargas. Inténtalo más tarde.");
    expect(DIGITAL_SESSION_ENDED_ERROR).toBe("Tu sesión terminó. Vuelve a ingresar.");
    expect(DIGITAL_DEFAULT_ERROR).toBe("No se pudo completar la acción");
  });
});

describe("F27 · UI · utf8ByteLength cuenta bytes, no caracteres", () => {
  it.each([
    ["", 0],
    ["a", 1],
    ["é", 2],
    ["€", 3],
    ["😀", 4],
    ["\r\n", 2],
    ["Año 😀\n", 10],
  ])("«%s» pesa %i bytes", (text, bytes) => {
    expect(utf8ByteLength(text)).toBe(bytes);
  });
});

describe("F27 · UI · validateMarkdownFile (bordes del tamaño y del vacío)", () => {
  it("un texto vacío se rechaza como vacío", () => {
    expect(validateMarkdownFile("")).toBe(FILE_EMPTY_ERROR);
  });

  it.each([
    " ",
    "   ",
    "\n",
    "\r\n\r\n",
    "\t \n ",
  ])("un texto solo con espacios o saltos (%j) se rechaza como vacío", (text) => {
    expect(validateMarkdownFile(text)).toBe(FILE_EMPTY_ERROR);
  });

  it("un byte de texto se acepta", () => {
    expect(validateMarkdownFile("a")).toBeNull();
  });

  it("un texto con HTML y scripts se acepta (se guarda tal cual)", () => {
    expect(validateMarkdownFile("# Título\n<script>alert(1)</script>")).toBeNull();
  });

  it("2.000.000 de bytes exactos se aceptan", () => {
    expect(DIGITAL_RULES.maxMarkdownBytes).toBe(2_000_000);
    expect(validateMarkdownFile("a".repeat(2_000_000))).toBeNull();
  });

  it("1.999.999 bytes se aceptan", () => {
    expect(validateMarkdownFile("a".repeat(1_999_999))).toBeNull();
  });

  it("2.000.001 bytes se rechazan por tamaño", () => {
    expect(validateMarkdownFile("a".repeat(2_000_001))).toBe(FILE_TOO_BIG_ERROR);
  });

  it("los espacios finales cuentan para el tamaño aunque el texto no esté vacío", () => {
    expect(validateMarkdownFile(`a${" ".repeat(2_000_000)}`)).toBe(FILE_TOO_BIG_ERROR);
  });

  it("500.000 emojis (2.000.000 de bytes, 1.000.000 de unidades UTF-16) se aceptan", () => {
    expect(validateMarkdownFile("😀".repeat(500_000))).toBeNull();
  });

  it("500.000 emojis y una «a» (2.000.001 bytes) se rechazan", () => {
    expect(validateMarkdownFile(`${"😀".repeat(500_000)}a`)).toBe(FILE_TOO_BIG_ERROR);
  });

  it("un millón de «é» (2.000.000 de bytes con solo 1.000.000 de caracteres) se aceptan; con una más, no", () => {
    expect(validateMarkdownFile("é".repeat(1_000_000))).toBeNull();
    expect(validateMarkdownFile(`${"é".repeat(1_000_000)}a`)).toBe(FILE_TOO_BIG_ERROR);
  });

  it("un texto con menos de 2.000.000 de caracteres pero más de 2.000.000 de bytes se rechaza", () => {
    expect(validateMarkdownFile("é".repeat(1_000_001))).toBe(FILE_TOO_BIG_ERROR);
  });

  it("\\r\\n cuenta como dos bytes", () => {
    const limit = "a".repeat(DIGITAL_RULES.maxMarkdownBytes - 2);
    expect(validateMarkdownFile(`${limit}\r\n`)).toBeNull();
    expect(validateMarkdownFile(`${limit}a\r\n`)).toBe(FILE_TOO_BIG_ERROR);
  });
});

describe("F27 · UI · isAllowedFileName (.md, .markdown, .txt)", () => {
  it.each([
    "libro.md",
    "libro.markdown",
    "notas.txt",
    "LIBRO.MD",
    "Libro.Markdown",
    "NOTAS.TXT",
    "mi.libro.final.md",
  ])("«%s» se permite", (name) => {
    expect(isAllowedFileName(name)).toBe(true);
  });

  it.each([
    "libro.pdf",
    "libro.epub",
    "libro.docx",
    "libro.html",
    "libro",
    "libro.md.exe",
    "libro.mdx",
    "libro.mdd",
    "",
  ])("«%s» no se permite", (name) => {
    expect(isAllowedFileName(name)).toBe(false);
  });
});

describe("F27 · UI · parseDigitalCopies (0–100)", () => {
  it.each([
    ["0", 0],
    ["1", 1],
    ["5", 5],
    ["99", 99],
    ["100", 100],
    [" 7 ", 7],
  ])("«%s» vale %i", (text, copies) => {
    expect(parseDigitalCopies(text)).toBe(copies);
  });

  it.each([
    "101",
    "1000",
    "-1",
    "-0",
    "1.5",
    "1,5",
    "3.0",
    "abc",
    "3a",
    "1e2",
    "+5",
    "",
    "   ",
    "NaN",
    "∞",
  ])("«%s» no vale", (text) => {
    expect(parseDigitalCopies(text)).toBeNull();
  });

  it("el mensaje de error pide un entero de 0 a 100", () => {
    expect(COPIES_INVALID_ERROR).toBe("Escribe un número entero de 0 a 100.");
  });
});

describe("F27 · UI · messageForDigitalError (regla 14)", () => {
  it("429 → «Demasiadas cargas. Inténtalo más tarde.»", () => {
    expect(messageForDigitalError(new DigitalRequestError(429, "Too many"))).toBe(
      "Demasiadas cargas. Inténtalo más tarde.",
    );
  });

  it.each([401, 403])("%i → «Tu sesión terminó. Vuelve a ingresar.»", (status) => {
    expect(messageForDigitalError(new DigitalRequestError(status, "otro texto"))).toBe(
      "Tu sesión terminó. Vuelve a ingresar.",
    );
  });

  it("un 409 muestra el texto del servidor tal cual", () => {
    const text = "Otra persona acaba de cargar un contenido para este libro. Inténtalo de nuevo.";
    expect(messageForDigitalError(new DigitalRequestError(409, text))).toBe(text);
  });

  it("un 409 por copias activas muestra el texto del servidor", () => {
    const text = "No puedes dejar menos copias digitales que préstamos digitales activos (2).";
    expect(messageForDigitalError(new DigitalRequestError(409, text))).toBe(text);
  });

  it.each([400, 404, 500])("un %i muestra el mensaje del servidor", (status) => {
    expect(messageForDigitalError(new DigitalRequestError(status, "El libro no existe."))).toBe("El libro no existe.");
  });

  it("un error de red se ve como «No se pudo completar la acción»", () => {
    expect(messageForDigitalError(new TypeError("Failed to fetch"))).toBe("No se pudo completar la acción");
  });

  it("un Error genérico no filtra su mensaje", () => {
    expect(messageForDigitalError(new Error("ECONNRESET en 10.0.0.1"))).toBe("No se pudo completar la acción");
  });

  it.each([
    "texto suelto",
    42,
    null,
    undefined,
  ])("un valor que no es un error (%j) da el mensaje por defecto", (value) => {
    expect(messageForDigitalError(value)).toBe("No se pudo completar la acción");
  });

  it("DigitalRequestError guarda el estado y el mensaje", () => {
    const error = new DigitalRequestError(409, "Choque");
    expect(error.status).toBe(409);
    expect(error.message).toBe("Choque");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("F27 · UI · formatKilobytes (1 KB = 1000 bytes)", () => {
  it.each([
    [1000, "1 KB"],
    [1049, "1 KB"],
    [1051, "1,1 KB"],
    [1500, "1,5 KB"],
    [10_000, "10 KB"],
    [0, "0 KB"],
  ])("%i bytes se muestran «%s»", (bytes, text) => {
    expect(formatKilobytes(bytes)).toBe(text);
  });

  it.each([1, 49])("un archivo no vacío de %i bytes nunca baja de «0,1 KB»", (bytes) => {
    expect(formatKilobytes(bytes)).toBe("0,1 KB");
  });

  it("2 MB se expresan en KB (2000 KB)", () => {
    expect(formatKilobytes(2_000_000)).toMatch(/^2\.?000 KB$/);
  });
});

describe("F27 · UI · describeDigitalState (estado actual, regla 13)", () => {
  it("un libro sin contenido: «Copias digitales: 0» y «Contenido: sin cargar»", () => {
    expect(describeDigitalState(anInfo())).toEqual({
      copies: "Copias digitales: 0",
      content: "Contenido: sin cargar",
    });
  });

  it("copias sin contenido: el contenido sigue «sin cargar»", () => {
    expect(describeDigitalState(anInfo({ digital_copies: 5 }))).toEqual({
      copies: "Copias digitales: 5",
      content: "Contenido: sin cargar",
    });
  });

  it("con contenido: «cargado (X KB, el {fecha})» con la fecha en la zona de Bogotá por defecto", () => {
    expect(describeDigitalState(anInfoWithContent())).toEqual({
      copies: "Copias digitales: 3",
      content: "Contenido: cargado (1,5 KB, el 1 de marzo de 2026)",
    });
  });

  it("la fecha usa la zona indicada: a las 03:00 UTC aún es el día anterior en Bogotá", () => {
    const info = anInfoWithContent({ content_updated_at: "2026-03-02T03:00:00.000Z" });

    expect(describeDigitalState(info).content).toBe("Contenido: cargado (1,5 KB, el 1 de marzo de 2026)");
    expect(describeDigitalState(info, "UTC").content).toBe("Contenido: cargado (1,5 KB, el 2 de marzo de 2026)");
  });

  it("con 100 copias muestra 100", () => {
    expect(describeDigitalState(anInfoWithContent({ digital_copies: 100 })).copies).toBe("Copias digitales: 100");
  });
});

describe("F27 · UI · avisos de éxito (regla 14)", () => {
  it("fijar varias copias: «Se guardaron N copias digitales de «Título».»", () => {
    expect(savedCopiesMessage("Rayuela", 5)).toBe("Se guardaron 5 copias digitales de «Rayuela».");
  });

  it("fijar 0 copias usa el plural", () => {
    expect(savedCopiesMessage("Rayuela", 0)).toBe("Se guardaron 0 copias digitales de «Rayuela».");
  });

  it("fijar 100 copias", () => {
    expect(savedCopiesMessage("Rayuela", 100)).toBe("Se guardaron 100 copias digitales de «Rayuela».");
  });

  it("fijar 1 copia usa el singular", () => {
    expect(savedCopiesMessage("Rayuela", 1)).toBe("Se guardó 1 copia digital de «Rayuela».");
  });

  it("cargar contenido: «Se cargó el contenido de «Título» (X KB).»", () => {
    expect(uploadedContentMessage(anInfoWithContent())).toBe("Se cargó el contenido de «Rayuela» (1,5 KB).");
  });

  it("el título con comillas o signos se conserva", () => {
    expect(uploadedContentMessage(anInfoWithContent({ title: "¿Quién? «X» & Y" }))).toBe(
      "Se cargó el contenido de «¿Quién? «X» & Y» (1,5 KB).",
    );
  });
});
