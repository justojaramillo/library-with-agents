import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/shared/server/security/rate-limit";
import { routeHolder, resetRouteHolder, signInAs } from "@/tests/helpers/digital-route-state";
import { byteLength } from "@/tests/helpers/digital";
import { errorOf, getInfo, patchCopies, putContent, putContentRaw } from "@/tests/helpers/digital-route-calls";
import { DigitalInfoSchema } from "../schema";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", async () => (await import("@/tests/helpers/digital-route-state")).headersMock);
vi.mock("@/shared/server/firebase", async () => (await import("@/tests/helpers/digital-route-state")).firebaseMock);
vi.mock("@/features/container", async () => (await import("@/tests/helpers/digital-route-state")).containerMock);

const NOW = new Date("2026-03-05T12:30:00.000Z");
const CONFLICT = "Otra persona acaba de cargar un contenido para este libro. Inténtalo de nuevo.";

beforeEach(() => {
  resetRateLimits();
  resetRouteHolder();
  signInAs("BIBLIOTECARIO");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function storedContent() {
  return (await routeHolder.world.books.find("libro-1"))?.content ?? null;
}

describe("F27 · PUT /api/books/:id/digital/content · caso feliz", () => {
  it("sube un Markdown de 1 KB: 200 con has_content, bytes e instante", async () => {
    const text = "x".repeat(1024);

    const response = await putContent("libro-1", text);

    expect(response.status).toBe(200);
    expect(DigitalInfoSchema.parse(await response.json())).toEqual({
      book_id: "libro-1",
      title: "Rayuela",
      digital_copies: 2,
      has_content: true,
      content_bytes: 1024,
      content_updated_at: NOW.toISOString(),
    });
    const paths = routeHolder.world.store.paths();
    expect(paths).toHaveLength(1);
    expect(paths[0]?.startsWith("books/libro-1/")).toBe(true);
  });

  it("la consulta GET posterior ve el contenido cargado", async () => {
    await putContent("libro-1", "# Hola");

    const info = DigitalInfoSchema.parse(await (await getInfo("libro-1")).json());

    expect(info).toMatchObject({ has_content: true, content_bytes: 6, content_updated_at: NOW.toISOString() });
  });

  it("reemplazar deja un solo archivo y el libro apunta al nuevo", async () => {
    await putContent("libro-1", "# Uno");
    const first = (await storedContent())?.path;
    await putContent("libro-1", "# Dos más largo");

    const second = (await storedContent())?.path;
    expect(second).not.toBe(first);
    expect(routeHolder.world.store.paths()).toEqual([second]);
  });

  it("el texto con comillas, saltos de línea y \\r\\n llega intacto (el JSON se desescapa)", async () => {
    const text = 'Dijo "hola"\r\n\ty\n\\ fin';

    const response = await putContent("libro-1", text);

    expect(response.status).toBe(200);
    expect(routeHolder.world.store.text(routeHolder.world.store.paths()[0] ?? "")).toBe(text);
    expect(DigitalInfoSchema.parse(await response.json()).content_bytes).toBe(byteLength(text));
  });

  it("campos de más en el cuerpo se ignoran", async () => {
    const response = await putContentRaw(
      "libro-1",
      JSON.stringify({ markdown: "# Hola", member_id: "otra", path: "x" }),
    );

    expect(response.status).toBe(200);
    expect(routeHolder.world.store.paths()[0]?.startsWith("books/libro-1/")).toBe(true);
  });
});

describe("F27 · PUT /api/books/:id/digital/content · tamaño del texto", () => {
  it.each([1, 1_999_999, 2_000_000])("%i bytes de texto responden 200", async (bytes) => {
    const response = await putContent("libro-1", "a".repeat(bytes));

    expect(response.status).toBe(200);
    expect(DigitalInfoSchema.parse(await response.json()).content_bytes).toBe(bytes);
  });

  it("2 000 001 bytes responden 400 y no se guarda nada", async () => {
    const response = await putContent("libro-1", "a".repeat(2_000_001));

    expect(response.status).toBe(400);
    expect(routeHolder.world.store.paths()).toEqual([]);
    expect(await storedContent()).toBeNull();
  });

  it("500 000 emojis (2 000 000 de bytes) responden 200 y uno más de 1 byte, 400", async () => {
    expect((await putContent("libro-1", "😀".repeat(500_000))).status).toBe(200);
    expect((await putContent("libro-1", "😀".repeat(500_000) + "a")).status).toBe(400);
  });

  it("1 999 999 saltos de línea y una letra (JSON de unos 4 MB, por debajo del tope) responden 200", async () => {
    const text = "\n".repeat(1_999_999) + "a";

    const response = await putContent("libro-1", text);

    expect(response.status).toBe(200);
    expect(DigitalInfoSchema.parse(await response.json()).content_bytes).toBe(2_000_000);
  });

  it("2 000 000 de «é» (4 MB de texto) responden 400", async () => {
    expect((await putContent("libro-1", "é".repeat(2_000_000))).status).toBe(400);
  });

  it.each([
    ["vacío", ""],
    ["solo espacios", "    "],
    ["solo saltos de línea", "\n\r\n\n"],
    ["con carácter nulo", "uno\u0000dos"],
  ])("texto %s responde 400", async (_name, text) => {
    const response = await putContent("libro-1", text);

    expect(response.status).toBe(400);
    expect(routeHolder.world.store.paths()).toEqual([]);
  });

  it("un texto rechazado no cambia el contenido anterior", async () => {
    await putContent("libro-1", "# Original");
    const before = await storedContent();

    expect((await putContent("libro-1", "")).status).toBe(400);

    expect(await storedContent()).toEqual(before);
    expect(routeHolder.world.store.paths()).toHaveLength(1);
  });
});

describe("F27 · PUT /api/books/:id/digital/content · cuerpo mal formado (400)", () => {
  it.each([
    ["no JSON", "esto no es json"],
    ["JSON incompleto", '{"markdown": "hola'],
    ["cuerpo vacío", ""],
    ["sin el campo markdown", "{}"],
    ["markdown numérico", '{"markdown": 123}'],
    ["markdown null", '{"markdown": null}'],
    ["markdown lista", '{"markdown": ["a"]}'],
    ["markdown objeto", '{"markdown": {"a": 1}}'],
    ["una lista", "[]"],
    ["un texto JSON", '"hola"'],
    ["null", "null"],
  ])("%s responde 400 y no guarda nada", async (_name, raw) => {
    const response = await putContentRaw("libro-1", raw);

    expect(response.status).toBe(400);
    expect(routeHolder.world.store.paths()).toEqual([]);
  });

  it("una petición sin cuerpo responde 400", async () => {
    expect((await putContentRaw("libro-1", null)).status).toBe(400);
  });

  it("un cuerpo por encima del tope (4 200 000 bytes) responde 400 y no guarda nada", async () => {
    const response = await putContent("libro-1", "a".repeat(4_300_000));

    expect(response.status).toBe(400);
    expect(routeHolder.world.store.paths()).toEqual([]);
  });

  it("un cuerpo que declara `content-length` por encima del tope responde 400", async () => {
    const headers = {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      "content-length": "9000000",
    };

    const response = await putContentRaw("libro-1", '{"markdown":"hola"}', headers);

    expect(response.status).toBe(400);
    expect(routeHolder.world.store.paths()).toEqual([]);
  });

  it("un cuerpo que supera el tope sin declarar `content-length` también responde 400", async () => {
    const raw = JSON.stringify({ markdown: "a", relleno: "b".repeat(4_300_000) });

    expect((await putContentRaw("libro-1", raw)).status).toBe(400);
  });
});

describe("F27 · PUT /api/books/:id/digital/content · conflictos y libro inexistente", () => {
  it("un libro inexistente responde 404 y no guarda nada", async () => {
    const response = await putContent("no-existe", "# Hola");

    expect(response.status).toBe(404);
    expect(routeHolder.world.store.paths()).toEqual([]);
  });

  it("dos subidas simultáneas: una responde 200, la otra 409, y queda un solo archivo", async () => {
    const [first, second] = await Promise.all([putContent("libro-1", "# Uno"), putContent("libro-1", "# Dos")]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const loser = [first, second].find((response) => response.status === 409);
    expect(await errorOf(loser ?? first)).toBe(CONFLICT);
    expect(routeHolder.world.store.paths()).toEqual([(await storedContent())?.path]);
  });

  it("subir contenido no impide fijar copias a la vez (son independientes)", async () => {
    const [upload, copies] = await Promise.all([
      putContent("libro-1", "# Uno"),
      patchCopies("libro-1", { digital_copies: 8 }),
    ]);

    expect([upload.status, copies.status]).toEqual([200, 200]);
    const stored = await routeHolder.world.books.find("libro-1");
    expect(stored?.digital_copies).toBe(8);
    expect(stored?.content).not.toBeNull();
  });
});
