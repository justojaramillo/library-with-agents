import { describe, expect, it } from "vitest";
import { CreateBookInputSchema, SearchBooksQuerySchema } from "@/features/catalog/schema";
import { filterBooks } from "@/features/catalog/server/book-search";
import type { BookRecord } from "@/features/catalog/server/repository";
import { ConflictError } from "@/shared/server/errors";
import { aBook, makeWorld } from "@/tests/helpers/factories";

const record = (id: string, title: string, author: string): BookRecord => ({
  id,
  isbn: `97800000000${id.padStart(2, "0")}`,
  title,
  author,
  copies: 1,
});

describe("F1 · registrar libro", () => {
  it("registra un libro y lo deja con todos los ejemplares disponibles", async () => {
    const { books } = makeWorld();
    const book = await books.create(aBook({ copies: 3 }));
    expect(typeof book.id).toBe("string");
    expect(book.id.length).toBeGreaterThan(0);
    expect(book.copies).toBe(3);
    expect(book.available).toBe(3);
  });

  it("devuelve ids distintos para libros distintos", async () => {
    const { books } = makeWorld();
    const first = await books.create(aBook());
    const second = await books.create(aBook());
    expect(first.id).not.toBe(second.id);
  });

  it("rechaza un ISBN repetido y el catálogo no cambia", async () => {
    const { books } = makeWorld();
    const input = aBook({ title: "Original" });
    await books.create(input);
    await expect(books.create({ ...input, title: "Copia" })).rejects.toThrow(ConflictError);
    const catalog = await books.search("");
    expect(catalog).toHaveLength(1);
    expect(catalog[0]?.title).toBe("Original");
  });

  it("guarda el título y el autor sin espacios al inicio ni al final", async () => {
    const { books } = makeWorld();
    const book = await books.create(aBook({ title: "  Rayuela  ", author: "  Julio Cortázar " }));
    expect(book.title).toBe("Rayuela");
    expect(book.author).toBe("Julio Cortázar");
  });

  it.each([
    ["9 dígitos", "123456789"],
    ["11 dígitos", "12345678901"],
    ["12 dígitos", "123456789012"],
    ["14 dígitos", "12345678901234"],
    ["con guiones", "978-0-306-40615-7"],
    ["con espacios", "978 0306406157"],
    ["con letras", "abc"],
    ["vacío", ""],
  ])("rechaza un ISBN %s", async (_name, isbn) => {
    const { books } = makeWorld();
    await expect(books.create(aBook({ isbn }))).rejects.toThrow();
    expect(await books.search("")).toHaveLength(0);
  });

  it.each([
    ["10 dígitos", "1234567890"],
    ["13 dígitos", "9780306406157"],
  ])("acepta un ISBN de %s", async (_name, isbn) => {
    const { books } = makeWorld();
    const book = await books.create(aBook({ isbn }));
    expect(book.isbn).toBe(isbn);
  });

  it("acepta un título de 1 y de 200 caracteres, y rechaza uno de 0 y de 201", async () => {
    const { books } = makeWorld();
    await expect(books.create(aBook({ title: "a" }))).resolves.toBeDefined();
    await expect(books.create(aBook({ title: "a".repeat(200) }))).resolves.toBeDefined();
    await expect(books.create(aBook({ title: "" }))).rejects.toThrow();
    await expect(books.create(aBook({ title: "a".repeat(201) }))).rejects.toThrow();
  });

  it("rechaza un título o un autor formado solo por espacios", async () => {
    const { books } = makeWorld();
    await expect(books.create(aBook({ title: "     " }))).rejects.toThrow();
    await expect(books.create(aBook({ author: "     " }))).rejects.toThrow();
    expect(await books.search("")).toHaveLength(0);
  });

  it("acepta un autor de 120 caracteres y rechaza uno de 121 o vacío", async () => {
    const { books } = makeWorld();
    await expect(books.create(aBook({ author: "a".repeat(120) }))).resolves.toBeDefined();
    await expect(books.create(aBook({ author: "a".repeat(121) }))).rejects.toThrow();
    await expect(books.create(aBook({ author: "" }))).rejects.toThrow();
  });

  it("el límite del título se mide después de recortar los espacios", async () => {
    const { books } = makeWorld();
    const book = await books.create(aBook({ title: ` ${"a".repeat(200)} ` }));
    expect(book.title).toHaveLength(200);
  });

  it("acepta 1 y 100 ejemplares, y rechaza 0 y 101", async () => {
    const { books } = makeWorld();
    expect((await books.create(aBook({ copies: 1 }))).available).toBe(1);
    expect((await books.create(aBook({ copies: 100 }))).available).toBe(100);
    await expect(books.create(aBook({ copies: 0 }))).rejects.toThrow();
    await expect(books.create(aBook({ copies: 101 }))).rejects.toThrow();
  });

  it("rechaza ejemplares negativos o decimales", async () => {
    const { books } = makeWorld();
    await expect(books.create(aBook({ copies: -1 }))).rejects.toThrow();
    await expect(books.create(aBook({ copies: 1.5 }))).rejects.toThrow();
  });

  it("el esquema rechaza ejemplares enviados como texto y los decimales", () => {
    const valid = aBook();
    expect(CreateBookInputSchema.safeParse({ ...valid, copies: "3" }).success).toBe(false);
    expect(CreateBookInputSchema.safeParse({ ...valid, copies: 2.5 }).success).toBe(false);
    expect(CreateBookInputSchema.safeParse({ ...valid, copies: 3 }).success).toBe(true);
  });

  it("el esquema señala el campo que falló", () => {
    const validation = CreateBookInputSchema.safeParse({ ...aBook(), isbn: "123" });
    expect(validation.success).toBe(false);
    if (!validation.success) {
      expect(validation.error.issues.map((issue) => issue.path.join("."))).toContain("isbn");
    }
  });
});

describe("F2 · buscar libros", () => {
  it("busca por título o autor, sin importar mayúsculas", async () => {
    const { books } = makeWorld();
    await books.create(aBook({ title: "Cien años de soledad", author: "Gabriel García Márquez" }));
    await books.create(aBook({ title: "El coronel no tiene quien le escriba", author: "Gabriel García Márquez" }));
    await books.create(aBook({ title: "Rayuela", author: "Julio Cortázar" }));

    expect((await books.search("SOLEDAD")).map((b) => b.title)).toEqual(["Cien años de soledad"]);
    expect(await books.search("garcía")).toHaveLength(2);
    expect(await books.search("")).toHaveLength(3);
    expect(await books.search("zzz")).toEqual([]);
  });

  it("encuentra por una parte del título aunque no sea el comienzo", async () => {
    const { books } = makeWorld();
    await books.create(aBook({ title: "Cien años de soledad" }));
    expect(await books.search("años de")).toHaveLength(1);
  });

  it("trata % y _ como texto literal, no como comodines", async () => {
    const { books } = makeWorld();
    await books.create(aBook({ title: "100% Java" }));
    await books.create(aBook({ title: "snake_case en la práctica" }));
    await books.create(aBook({ title: "Otro libro" }));
    expect((await books.search("%")).map((b) => b.title)).toEqual(["100% Java"]);
    expect((await books.search("_")).map((b) => b.title)).toEqual(["snake_case en la práctica"]);
  });

  it("el texto vacío o de solo espacios lista todo el catálogo ordenado por título", async () => {
    const { books } = makeWorld();
    await books.create(aBook({ title: "Rayuela" }));
    await books.create(aBook({ title: "Aura" }));
    await books.create(aBook({ title: "Pedro Páramo" }));
    expect((await books.search("")).map((b) => b.title)).toEqual(["Aura", "Pedro Páramo", "Rayuela"]);
    expect((await books.search("   ")).map((b) => b.title)).toEqual(["Aura", "Pedro Páramo", "Rayuela"]);
  });

  it("sobre un catálogo vacío devuelve una lista vacía, no un error", async () => {
    const { books } = makeWorld();
    await expect(books.search("")).resolves.toEqual([]);
    await expect(books.search("algo")).resolves.toEqual([]);
  });

  it("ignora los espacios alrededor del texto buscado", async () => {
    const { books } = makeWorld();
    await books.create(aBook({ title: "Rayuela" }));
    expect(await books.search("  rayuela  ")).toHaveLength(1);
  });

  it("el esquema de la consulta usa texto vacío por defecto y acepta 100 caracteres pero no 101", () => {
    expect(SearchBooksQuerySchema.parse({}).q).toBe("");
    expect(SearchBooksQuerySchema.safeParse({ q: "a".repeat(100) }).success).toBe(true);
    expect(SearchBooksQuerySchema.safeParse({ q: "a".repeat(101) }).success).toBe(false);
    expect(SearchBooksQuerySchema.parse({ q: "   " }).q).toBe("");
  });
});

describe("F2 · disponibilidad de cada resultado", () => {
  const loanOf = (bookId: string, memberId: string, returned: string | null) => ({
    book_id: bookId,
    member_id: memberId,
    loaned_at: "2026-01-01T10:00:00.000Z",
    due_at: "2026-01-16T10:00:00.000Z",
    returned_at: returned,
  });

  it("available = ejemplares − préstamos activos", async () => {
    const { books, repos } = makeWorld();
    const book = await books.create(aBook({ copies: 3 }));
    await repos.loans.create(loanOf(book.id, "m-1", null));
    const [found] = await books.search("");
    expect(found?.available).toBe(2);
  });

  it("un préstamo devuelto no resta disponibilidad", async () => {
    const { books, repos } = makeWorld();
    const book = await books.create(aBook({ copies: 2 }));
    await repos.loans.create(loanOf(book.id, "m-1", "2026-01-05T10:00:00.000Z"));
    const [found] = await books.search("");
    expect(found?.available).toBe(2);
  });

  it("available llega a 0 cuando todos los ejemplares están prestados", async () => {
    const { books, repos } = makeWorld();
    const book = await books.create(aBook({ copies: 2 }));
    await repos.loans.create(loanOf(book.id, "m-1", null));
    await repos.loans.create(loanOf(book.id, "m-2", null));
    const [found] = await books.search("");
    expect(found?.available).toBe(0);
  });

  it("available nunca es negativo aunque haya más préstamos activos que ejemplares", async () => {
    const { books, repos } = makeWorld();
    const book = await books.create(aBook({ copies: 1 }));
    await repos.loans.create(loanOf(book.id, "m-1", null));
    await repos.loans.create(loanOf(book.id, "m-2", null));
    const [found] = await books.search("");
    expect(found?.available).toBe(0);
  });

  it("los préstamos de un libro no afectan la disponibilidad de otro", async () => {
    const { books, repos } = makeWorld();
    const lent = await books.create(aBook({ title: "A prestado", copies: 1 }));
    const free = await books.create(aBook({ title: "B libre", copies: 1 }));
    await repos.loans.create(loanOf(lent.id, "m-1", null));
    const found = await books.search("");
    expect(found.find((b) => b.id === lent.id)?.available).toBe(0);
    expect(found.find((b) => b.id === free.id)?.available).toBe(1);
  });
});

describe("F2 · filtro de búsqueda (filterBooks)", () => {
  const catalog = [
    record("1", "Rayuela", "Julio Cortázar"),
    record("2", "Cien años de soledad", "Gabriel García Márquez"),
    record("3", "100% Java", "Ana Pérez"),
  ];

  it("busca en título o en autor sin distinguir mayúsculas", () => {
    expect(filterBooks(catalog, "SOLEDAD").map((b) => b.id)).toEqual(["2"]);
    expect(filterBooks(catalog, "cortázar").map((b) => b.id)).toEqual(["1"]);
  });

  it("devuelve todo, ordenado por título, con texto vacío", () => {
    expect(filterBooks(catalog, "").map((b) => b.title)).toEqual(["100% Java", "Cien años de soledad", "Rayuela"]);
  });

  it("% es texto literal", () => {
    expect(filterBooks(catalog, "%").map((b) => b.id)).toEqual(["3"]);
  });

  it("devuelve lista vacía si nada coincide", () => {
    expect(filterBooks(catalog, "zzz")).toEqual([]);
  });

  it("no modifica la lista original", () => {
    const original = [...catalog];
    filterBooks(catalog, "");
    expect(catalog).toEqual(original);
  });
});
