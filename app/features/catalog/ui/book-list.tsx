import type { Book } from "../schema";
import { Availability } from "./availability";

function BookItem({ book }: { book: Book }) {
  return (
    <li>
      <article className="flex h-full flex-col gap-2 rounded border border-line bg-surface p-4">
        <h3 className="text-lg font-semibold">{book.title}</h3>
        <dl className="text-ink-muted">
          <dt className="sr-only">Autor</dt>
          <dd>{book.author}</dd>
          <dt className="inline">ISBN: </dt>
          <dd className="inline">{book.isbn}</dd>
        </dl>
        <Availability available={book.available} copies={book.copies} />
      </article>
    </li>
  );
}

/** Lista de libros: 1 columna a 360 px, 2 desde 768 px y 3 desde 1024 px. */
export function BookList({ books }: { books: Book[] }) {
  if (books.length === 0) {
    return <p className="text-ink-muted">No hay libros que coincidan.</p>;
  }
  return (
    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {books.map((book) => (
        <BookItem key={book.id} book={book} />
      ))}
    </ul>
  );
}
