# Mensaje de derechos de autor (texto oficial del lector)

Texto que muestra el lector interactivo (F29/F30) cuando la persona cambia de pestaña o de aplicación. El frontend lo toma de aquí (o de la constante del contrato `app/features/reader/schema.ts` cuando exista); no lo reescribe.

## Capa de bloqueo (a pantalla completa, sobre la marca de agua)

> ### Este libro cuida a quien lo escribió ✍️
>
> Detrás de cada página hay meses —a veces años— de trabajo, de dudas y de cariño de una autora o de un autor.
> Los derechos de autor son la forma en que la sociedad le dice a quien crea: **«tu obra importa, y tú decides cómo se comparte»**.
>
> Esta lectura es un préstamo personal. Disfrútala aquí, con calma, y ayúdanos a que sigan existiendo historias que valgan la pena leer.
>
> *Pausamos tu lectura porque saliste de esta ventana. Vuelve cuando quieras: tu página te espera.*
>
> **[ Continuar leyendo ]**
>
> — Gracias por respetar el trabajo creativo · Biblioteca

## Marca de agua repetida (en diagonal, ~15 % de opacidad)

`Obra protegida por derechos de autor · Lectura personal de {nombre} · {fecha}`

## Reglas de uso
- El nombre y la fecha vienen de la sesión en el servidor, nunca de un parámetro de la URL.
- El mensaje se muestra con `role="dialog"`, `aria-modal="true"` y el foco en el botón «Continuar leyendo».
- El contraste del texto debe cumplir WCAG AA sobre el fondo de la capa.
- Sin el botón pulsado, el texto del libro **no** vuelve a la pantalla (ver reglas del lector en `docs/features.md`).
