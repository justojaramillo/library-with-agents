"use client";

// El orden importa, no lo reordenes: fija Zod sin compilación antes de cargar esquemas (CSP).
import "@/shared/ui/client-setup";
import { z } from "zod";
import { BookSchema, type Book } from "@/features/catalog/schema";
import { SearchPicker, SUGGESTION_LIMIT } from "@/features/loans/ui/search-picker";

const BooksSchema = z.array(BookSchema);

function buildUrl(q: string): string {
  return `/api/books?q=${encodeURIComponent(q)}&limit=${SUGGESTION_LIMIT + 1}`;
}

/** «Título — Autor». Aquí no importa si quedan ejemplares físicos: el contenido digital es aparte. */
function describe(book: Book): string {
  return `${book.title} — ${book.author}`;
}

function getKey(book: Book): string {
  return book.id;
}

type DigitalBookPickerProps = {
  selected: Book | null;
  onSelect: (book: Book) => void;
  onClear: () => void;
};

/** Buscador de libros (F27, regla 13): hasta 10 sugerencias; cualquier libro se puede elegir. */
export function DigitalBookPicker({ selected, onSelect, onClear }: DigitalBookPickerProps) {
  return (
    <SearchPicker
      label="Buscar libro (título o autor)"
      selectedLabel="Libro seleccionado"
      buildUrl={buildUrl}
      schema={BooksSchema}
      selected={selected}
      onSelect={onSelect}
      onClear={onClear}
      describe={describe}
      suggestionText={describe}
      getKey={getKey}
    />
  );
}
