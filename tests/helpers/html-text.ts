/** Ayudantes para revisar qué elementos de HTML estático llevan texto (sin depender de un navegador). */

const VOID_TAGS = new Set(["br", "hr", "img", "input", "meta", "link"]);

/**
 * Nombre de la etiqueta que contiene cada fragmento de texto no vacío del HTML, en orden del documento.
 * Sirve para comprobar que `div` y `span` no llevan contenido (solo estructura).
 */
export function textOwners(html: string): { tag: string; text: string }[] {
  const owners: { tag: string; text: string }[] = [];
  const stack: string[] = [];
  for (const token of html.matchAll(/<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>|[^<]+/g)) {
    const piece = token[0];
    if (piece.startsWith("<!--")) {
      continue;
    }
    if (piece.startsWith("</")) {
      stack.pop();
      continue;
    }
    if (piece.startsWith("<")) {
      const name = /^<([a-zA-Z0-9]+)/.exec(piece)?.[1]?.toLowerCase() ?? "";
      if (!piece.endsWith("/>") && !VOID_TAGS.has(name)) {
        stack.push(name);
      }
      continue;
    }
    if (piece.trim() !== "") {
      owners.push({ tag: stack.at(-1) ?? "", text: piece.trim() });
    }
  }
  return owners;
}

/** Texto de la etiqueta de apertura del botón cuyo texto visible es `text`, o `null`. */
export function buttonLabelled(html: string, text: string): string | null {
  for (const match of html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)) {
    if (match[2].replace(/<[^>]*>/g, "").trim() === text) {
      return `<button${match[1]}>`;
    }
  }
  return null;
}

/** Cada `<article>…</article>` del HTML. */
export function articlesOf(html: string): string[] {
  return html.match(/<article\b[\s\S]*?<\/article>/g) ?? [];
}
