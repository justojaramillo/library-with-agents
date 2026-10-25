/** Ayudantes para leer HTML estático de `renderToStaticMarkup` sin depender del orden de los atributos. */

/** Etiquetas de apertura de un elemento (`<input ...>`), en el orden del documento. */
export function openingTags(html: string, tag: string): string[] {
  const found = html.match(new RegExp(`<${tag}\\b[^>]*>`, "g"));
  if (found === null) {
    return [];
  }
  return found;
}

/** Valor de un atributo de una etiqueta de apertura (sin distinguir mayúsculas), o `null` si no está. */
export function attributeOf(openTag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}="([^"]*)"`, "i").exec(openTag);
  if (match === null) {
    return null;
  }
  return match[1];
}

/** `true` si la etiqueta de apertura tiene el atributo (también los booleanos como `required=""`). */
export function hasAttribute(openTag: string, name: string): boolean {
  return new RegExp(`\\s${name}(=|\\s|/|>)`, "i").test(openTag);
}

/** Texto visible de un fragmento: quita las etiquetas y recorta. */
export function textOf(fragment: string): string {
  return fragment.replace(/<[^>]*>/g, "").trim();
}

/** Etiqueta de apertura del primer elemento con ese `id`, o `null`. */
export function tagById(html: string, id: string): string | null {
  const match = new RegExp(`<[a-z0-9]+\\b[^>]*\\sid="${id}"[^>]*>`).exec(html);
  if (match === null) {
    return null;
  }
  return match[0];
}

/** Campo (`input`) enlazado por `for`/`id` a la etiqueta `<label>` con ese texto, o `null`. */
export function fieldLabelled(html: string, labelText: string): string | null {
  const labels = html.matchAll(/<label([^>]*)>([\s\S]*?)<\/label>/g);
  for (const label of labels) {
    if (textOf(label[2]) !== labelText) {
      continue;
    }
    const target = attributeOf(`<label${label[1]}>`, "for");
    if (target !== null) {
      return tagById(html, target);
    }
    const nested = openingTags(label[2], "input");
    if (nested.length > 0) {
      return nested[0];
    }
  }
  return null;
}

/** Textos de todos los enlaces `<a>` hacia ese destino. */
export function linkTexts(html: string, href: string): string[] {
  const texts: string[] = [];
  for (const link of html.matchAll(/<a([^>]*)>([\s\S]*?)<\/a>/g)) {
    if (attributeOf(`<a${link[1]}>`, "href") === href) {
      texts.push(textOf(link[2]));
    }
  }
  return texts;
}
