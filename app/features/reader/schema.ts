import { z } from "zod";
import { IdSchema } from "@/shared/schema";

/** F27 · Reglas del contenido digital (`docs/specs/F27-contenido-digital-del-libro.md`). */
export const DIGITAL_RULES = {
  maxCopies: 100,
  /** Tamaño máximo del texto en bytes UTF-8; por debajo del límite de 4,5 MB del cuerpo de una función de Vercel. */
  maxMarkdownBytes: 2_000_000,
} as const;

/** F27 · Fijar las copias digitales de un libro — entrada de `PATCH /api/books/:id/digital/copies`. */
export const SetDigitalCopiesInputSchema = z.object({
  digital_copies: z.number().int().min(0).max(DIGITAL_RULES.maxCopies),
});
export type SetDigitalCopiesInput = z.infer<typeof SetDigitalCopiesInputSchema>;

/**
 * F27 · Cargar el contenido de un libro — entrada de `PUT /api/books/:id/digital/content`. El servicio comprueba
 * el tamaño en bytes UTF-8, que no quede vacío tras recortar y que no lleve el carácter nulo.
 */
export const UploadContentInputSchema = z.object({
  markdown: z.string(),
});
export type UploadContentInput = z.infer<typeof UploadContentInputSchema>;

/** F27 · Estado digital de un libro. Nunca incluye el texto ni la ruta del archivo en Blob. */
export const DigitalInfoSchema = z.object({
  book_id: IdSchema,
  title: z.string(),
  digital_copies: z.number().int().min(0).max(DIGITAL_RULES.maxCopies),
  has_content: z.boolean(),
  content_bytes: z.number().int().min(0).nullable(),
  content_updated_at: z.string().nullable(),
});
export type DigitalInfo = z.infer<typeof DigitalInfoSchema>;
