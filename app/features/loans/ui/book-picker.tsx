"use client";

// El orden importa, no lo reordenes: fija Zod sin compilación antes de cargar esquemas (CSP).
import "@/shared/ui/client-setup";
import { z } from "zod";
import { BookSchema, type Book } from "@/features/catalog/schema";
import { SearchPicker, SUGGESTION_LIMIT } from "./search-picker";

const BooksSchema = z.array(BookSchema);

function buildUrl(q: string): string {
  return `/api/books?q=${encodeURIComponent(q)}&limit=${SUGGESTION_LIMIT + 1}`;
}

function availabilityText(available: number): string {
  if (available === 0) {
    return "agotado";
  }
  if (available === 1) {
    return "1 disponible";
  }
  return `${available} disponibles`;
}

function suggestionText(book: Book): string {
  return `${book.title} — ${book.author} — ${availabilityText(book.available)}`;
}

function describe(book: Book): string {
  return `${book.title} — ${book.author}`;
}

function isUnavailable(book: Book): boolean {
  return book.available === 0;
}

function getKey(book: Book): string {
  return book.id;
}

type BookPickerProps = {
  onSelect: (book: Book) => void;
  selected: Book | null;
  onClear: () => void;
};

/** Buscador de libros; los agotados se muestran pero no se pueden elegir. */
export function BookPicker({ onSelect, selected, onClear }: BookPickerProps) {
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
      suggestionText={suggestionText}
      isUnavailable={isUnavailable}
      getKey={getKey}
    />
  );
}
