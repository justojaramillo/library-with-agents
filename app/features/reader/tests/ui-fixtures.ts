import type { DigitalInfo } from "../schema";

/** Estado digital de un libro de prueba; sin contenido por defecto. */
export function anInfo(over: Partial<DigitalInfo> = {}): DigitalInfo {
  return {
    book_id: "book-1",
    title: "Rayuela",
    digital_copies: 0,
    has_content: false,
    content_bytes: null,
    content_updated_at: null,
    ...over,
  };
}

/** Estado digital de un libro con contenido cargado. */
export function anInfoWithContent(over: Partial<DigitalInfo> = {}): DigitalInfo {
  return anInfo({
    digital_copies: 3,
    has_content: true,
    content_bytes: 1500,
    content_updated_at: "2026-03-01T10:00:00.000Z",
    ...over,
  });
}
