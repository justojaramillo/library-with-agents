import { z } from "zod";
import { IdSchema } from "@/shared/schema";

/** F1 · Registrar libro — entrada. */
export const CreateBookInputSchema = z.object({
  isbn: z.string().regex(/^\d{10}(\d{3})?$/, "ISBN de 10 o 13 dígitos, sin guiones"),
  title: z.string().trim().min(1).max(200),
  author: z.string().trim().min(1).max(120),
  copies: z.number().int().min(1).max(100),
});
export type CreateBookInput = z.infer<typeof CreateBookInputSchema>;

export const BookSchema = CreateBookInputSchema.extend({
  id: IdSchema,
  /** Ejemplares disponibles ahora mismo (copies - préstamos activos). */
  available: z.number().int().min(0),
});
export type Book = z.infer<typeof BookSchema>;

/** F2 · Buscar libros — entrada. Busca en título y autor, sin distinguir mayúsculas. */
export const SearchBooksQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
});
export type SearchBooksQuery = z.infer<typeof SearchBooksQuerySchema>;
