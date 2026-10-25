# F2 · Buscar libros por título o autor

- **Estado:** Aprobada (ejemplo terminado para usar como modelo)
- **Rol(es):** público (sin sesión)
- **Contrato afectado:** `app/features/catalog/schema.ts` (`SearchBooksQuerySchema`, `BookSchema`)

## Objetivo
Cualquier visitante encuentra libros escribiendo parte del título o del autor.

## Reglas de negocio
1. La búsqueda es parcial y no distingue mayúsculas.
2. Busca en título **o** autor.
3. Texto vacío lista todo el catálogo, ordenado por título.
4. `%` y `_` son texto literal, no comodines.
5. Cada resultado incluye `available` = ejemplares − préstamos activos (nunca negativo).

## Entradas y salidas
| Entrada | Tipo / restricción |
| --- | --- |
| `q` | texto, máx. 100 caracteres, se recortan espacios; por defecto `""` |

Salida: lista de `Book`. Errores: `400` si `q` excede 100 caracteres.

## Autorización
Pública: no requiere sesión.

## Criterios de aceptación
- **Dado** libros "Cien años de soledad" y "Rayuela", **cuando** busco "SOLEDAD", **entonces** obtengo solo el primero.
- **Dado** dos libros del mismo autor, **cuando** busco por el apellido, **entonces** obtengo ambos.
- **Dado** un libro "100% Java", **cuando** busco "%", **entonces** obtengo solo ese libro.
- **Dado** ningún resultado, **entonces** obtengo lista vacía (no error).

## Bordes
Texto vacío · 100 caracteres · 101 caracteres · solo espacios.

## Fuera de alcance
Paginación, ordenar por relevancia, filtros por disponibilidad.

## Preguntas abiertas
Ninguna.
