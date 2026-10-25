import { describe, expect, it } from "vitest";
import { CreateBookInputSchema } from "../schema";
import {
  BOOK_DEFAULT_ERROR,
  BOOK_DUPLICATE_ERROR,
  BOOK_INVALID_DATA_ERROR,
  BOOK_SESSION_ENDED_ERROR,
  BookRequestError,
  createdBookMessage,
  messageForBookError,
  normalizeIsbn,
} from "../ui/book-form";
import { readApiErrorMessage } from "../ui/request-error";

/** Lo que hace el formulario antes de enviar: quita guiones y espacios del ISBN y valida con el contrato. */
function validate(over: { isbn?: string; title?: string; author?: string; copies?: number } = {}) {
  return CreateBookInputSchema.safeParse({
    isbn: normalizeIsbn(over.isbn ?? "9788437604947"),
    title: over.title ?? "Rayuela",
    author: over.author ?? "Julio Cortázar",
    copies: over.copies ?? 1,
  });
}

describe("F36 · normalizeIsbn (regla 3)", () => {
  it.each([
    ["978-84-376-0494-7", "9788437604947"],
    ["978 84 376 0494 7", "9788437604947"],
    ["978\t84\t376\t0494\t7", "9788437604947"],
    ["978-84 376\t0494-7", "9788437604947"],
    ["  9788437604947  ", "9788437604947"],
    ["978 84376 0494 7", "9788437604947"],
    ["84-376-0494-7", "8437604947"],
  ])("«%s» queda como «%s»", (raw, expected) => {
    expect(normalizeIsbn(raw)).toBe(expected);
  });

  it("un ISBN ya normalizado no cambia", () => {
    expect(normalizeIsbn("9788437604947")).toBe("9788437604947");
    expect(normalizeIsbn("8437604947")).toBe("8437604947");
  });

  it("vacío, solo espacios y solo guiones quedan vacíos", () => {
    expect(normalizeIsbn("")).toBe("");
    expect(normalizeIsbn("   \t ")).toBe("");
    expect(normalizeIsbn("---")).toBe("");
  });

  it("las letras se conservan para que la validación del contrato las rechace", () => {
    expect(normalizeIsbn("84-376-049X")).toBe("84376049X");
    expect(validate({ isbn: "843760494X" }).success).toBe(false);
    expect(validate({ isbn: "978-84-376-ABCD-7" }).success).toBe(false);
  });

  it("es idempotente", () => {
    const once = normalizeIsbn("978-84 376-0494-7");
    expect(normalizeIsbn(once)).toBe(once);
  });
});

describe("F36 · ISBN según el contrato tras normalizar (reglas 3 y 4)", () => {
  it.each([
    ["9 dígitos", "123456789", false],
    ["10 dígitos", "8437604947", true],
    ["13 dígitos", "9788437604947", true],
    ["14 dígitos", "97884376049470", false],
    ["11 dígitos", "84376049470", false],
    ["13 dígitos con guiones", "978-84-376-0494-7", true],
    ["10 dígitos con espacios", "84 376 0494 7", true],
    ["13 dígitos con letras", "97884376049X7", false],
    ["vacío", "", false],
    ["solo espacios", "   ", false],
  ])("%s → válido: %s", (_nombre, isbn, expected) => {
    expect(validate({ isbn }).success).toBe(expected);
  });

  it("el ISBN con guiones se envía sin ellos", () => {
    const parsed = validate({ isbn: "978-84-376-0494-7" });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.isbn).toBe("9788437604947");
  });

  it("el contrato del servidor no cambia: con guiones, sin normalizar, sigue rechazándose", () => {
    const direct = CreateBookInputSchema.safeParse({
      isbn: "978-84-376-0494-7",
      title: "Rayuela",
      author: "Julio Cortázar",
      copies: 1,
    });
    expect(direct.success).toBe(false);
  });

  it("el error de un ISBN inválido señala el campo isbn", () => {
    const parsed = validate({ isbn: "123456789" });
    expect(parsed.error?.issues.map((issue) => issue.path[0])).toEqual(["isbn"]);
  });
});

describe("F36 · título y autor según el contrato (regla 4)", () => {
  it.each([
    ["0 caracteres", "", false],
    ["1 carácter", "a", true],
    ["200 caracteres", "a".repeat(200), true],
    ["201 caracteres", "a".repeat(201), false],
    ["solo espacios", "     ", false],
  ])("título de %s → válido: %s", (_nombre, title, expected) => {
    expect(validate({ title }).success).toBe(expected);
  });

  it.each([
    ["0 caracteres", "", false],
    ["1 carácter", "a", true],
    ["120 caracteres", "a".repeat(120), true],
    ["121 caracteres", "a".repeat(121), false],
    ["solo espacios", "   ", false],
  ])("autor de %s → válido: %s", (_nombre, author, expected) => {
    expect(validate({ author }).success).toBe(expected);
  });

  it("el título y el autor se recortan antes de enviarse", () => {
    const parsed = validate({ title: "  Rayuela  ", author: "  Julio Cortázar " });
    expect(parsed.data?.title).toBe("Rayuela");
    expect(parsed.data?.author).toBe("Julio Cortázar");
  });

  it("200 caracteres más espacios alrededor sigue siendo válido (se recortan)", () => {
    expect(validate({ title: ` ${"a".repeat(200)} ` }).success).toBe(true);
  });
});

describe("F36 · ejemplares según el contrato (regla 4)", () => {
  it.each([
    [0, false],
    [1, true],
    [2, true],
    [100, true],
    [101, false],
    [-1, false],
    [1.5, false],
    [Number.NaN, false],
  ])("ejemplares %s → válido: %s", (copies, expected) => {
    expect(validate({ copies }).success).toBe(expected);
  });

  it("el error de ejemplares señala el campo copies", () => {
    expect(validate({ copies: 0 }).error?.issues.map((issue) => issue.path[0])).toEqual(["copies"]);
  });

  it("varios campos inválidos dan un error por cada uno", () => {
    const parsed = validate({ isbn: "1", title: "", author: "", copies: 0 });
    const fields = new Set(parsed.error?.issues.map((issue) => issue.path[0]));
    expect(fields).toEqual(new Set(["isbn", "title", "author", "copies"]));
  });
});

describe("F36 · createdBookMessage (regla 5)", () => {
  it("con 1 ejemplar usa el singular", () => {
    expect(createdBookMessage("Rayuela", 1)).toBe("Se registró «Rayuela» con 1 ejemplar.");
  });

  it("con 2 ejemplares usa el plural", () => {
    expect(createdBookMessage("Rayuela", 2)).toBe("Se registró «Rayuela» con 2 ejemplares.");
  });

  it("con 100 ejemplares usa el plural", () => {
    expect(createdBookMessage("Rayuela", 100)).toBe("Se registró «Rayuela» con 100 ejemplares.");
  });

  it("no interpreta el título (React lo escapa al pintarlo)", () => {
    expect(createdBookMessage("<b>Hola</b>", 3)).toBe("Se registró «<b>Hola</b>» con 3 ejemplares.");
  });
});

describe("F36 · messageForBookError (regla 5)", () => {
  it("las constantes son los textos de la especificación", () => {
    expect(BOOK_DUPLICATE_ERROR).toBe("Ya existe un libro con ese ISBN.");
    expect(BOOK_INVALID_DATA_ERROR).toBe("Revisa los datos del formulario.");
    expect(BOOK_SESSION_ENDED_ERROR).toBe("Tu sesión terminó. Vuelve a ingresar.");
    expect(BOOK_DEFAULT_ERROR).toBe("No se pudo registrar el libro");
  });

  it("409 → «Ya existe un libro con ese ISBN.», sea cual sea el texto del servidor", () => {
    expect(messageForBookError(new BookRequestError(409, "El ISBN ya existe"))).toBe(
      "Ya existe un libro con ese ISBN.",
    );
  });

  it("400 → «Revisa los datos del formulario.»", () => {
    expect(messageForBookError(new BookRequestError(400, "Datos inválidos"))).toBe("Revisa los datos del formulario.");
  });

  it.each([401, 403])("%s → «Tu sesión terminó. Vuelve a ingresar.»", (status) => {
    expect(messageForBookError(new BookRequestError(status, "Prohibido"))).toBe(
      "Tu sesión terminó. Vuelve a ingresar.",
    );
  });

  it.each([404, 422, 429, 500, 503])("el estado %s muestra el mensaje del servidor", (status) => {
    expect(messageForBookError(new BookRequestError(status, "Mensaje del servidor"))).toBe("Mensaje del servidor");
  });

  it("un error de red (TypeError de fetch) → «No se pudo registrar el libro»", () => {
    expect(messageForBookError(new TypeError("Failed to fetch"))).toBe("No se pudo registrar el libro");
  });

  it.each([
    ["un Error cualquiera", new Error("algo")],
    ["un texto", "409"],
    ["null", null],
    ["undefined", undefined],
    ["un número", 409],
    ["un objeto con estado 409 que no es BookRequestError", { status: 409, message: "x" }],
  ])("%s no es un error del servidor → «No se pudo registrar el libro»", (_nombre, value) => {
    expect(messageForBookError(value)).toBe("No se pudo registrar el libro");
  });

  it("BookRequestError conserva estado y mensaje", () => {
    const error = new BookRequestError(409, "x");
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(409);
    expect(error.message).toBe("x");
  });
});

describe("F36 · readApiErrorMessage (respuesta del servidor validada con ApiErrorSchema)", () => {
  it("usa el error del cuerpo cuando cumple el contrato", async () => {
    const res = Response.json({ error: "Ya existe un libro con ese ISBN" }, { status: 409 });
    expect(await readApiErrorMessage(res, "respaldo")).toBe("Ya existe un libro con ese ISBN");
  });

  it("cuerpo que no es JSON → respaldo", async () => {
    const res = new Response("<html>502</html>", { status: 502 });
    expect(await readApiErrorMessage(res, "respaldo")).toBe("respaldo");
  });

  it("cuerpo JSON que no cumple el contrato → respaldo", async () => {
    expect(await readApiErrorMessage(Response.json({ mensaje: "x" }, { status: 500 }), "respaldo")).toBe("respaldo");
    expect(await readApiErrorMessage(Response.json({ error: 5 }, { status: 500 }), "respaldo")).toBe("respaldo");
    expect(await readApiErrorMessage(Response.json(null, { status: 500 }), "respaldo")).toBe("respaldo");
  });

  it("cuerpo vacío → respaldo", async () => {
    expect(await readApiErrorMessage(new Response(null, { status: 500 }), "respaldo")).toBe("respaldo");
  });
});
