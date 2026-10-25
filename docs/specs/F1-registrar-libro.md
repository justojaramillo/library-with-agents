# F1 · Registrar un libro

- **Estado:** Aprobada
- **Rol(es):** personal (`BIBLIOTECARIO` o `ADMINISTRADOR`)
- **Contrato afectado:** `app/features/catalog/schema.ts` (`CreateBookInputSchema`, `BookSchema`)

## Objetivo
El personal agrega un libro al catálogo indicando su ISBN, título, autor y número de ejemplares físicos.

## Reglas de negocio
1. El ISBN tiene 10 o 13 dígitos, sin guiones ni espacios, y es único en el catálogo (`ConflictError` si ya existe).
2. El título (1–200 caracteres) y el autor (1–120) se guardan sin espacios al inicio ni al final y no pueden quedar vacíos.
3. `copies` (ejemplares físicos) es un entero entre 1 y 100.
4. El libro creado se devuelve con `available` = `copies` (todavía no hay préstamos).
5. Solo el personal registra libros: sin sesión → 401; con rol de prestatario → 403.

## Entradas y salidas
| Entrada | Tipo / restricción |
| --- | --- |
| `isbn` | texto, `^\d{10}(\d{3})?$` |
| `title` | texto, 1–200, recortado |
| `author` | texto, 1–120, recortado |
| `copies` | entero, 1–100 |

Salida exitosa: `201` con `Book` (`id`, `isbn`, `title`, `author`, `copies`, `available`).
Errores esperados: `400` (validación, con `issues`) · `401` (sin sesión) · `403` (rol no permitido) · `409` (`ConflictError`, ISBN repetido).

## Autorización
Sí: `BIBLIOTECARIO`, `ADMINISTRADOR`. No: `EXTERNO`, `ESTUDIANTE`, `DOCENTE`. Sin sesión: 401. La identidad sale de la sesión.

## Criterios de aceptación
- **Dado** datos válidos, **cuando** el personal registra el libro, **entonces** recibe 201 con `available` igual a `copies`.
- **Dado** un ISBN ya registrado, **cuando** se registra otro libro con ese ISBN, **entonces** 409 y el catálogo no cambia.
- **Dado** un título con espacios alrededor, **cuando** se registra, **entonces** se guarda recortado.
- **Dado** un ISBN con guiones o de 11 dígitos, **cuando** se registra, **entonces** 400.
- **Dado** una petición sin sesión, **cuando** se registra, **entonces** 401; con un `ESTUDIANTE`, 403.

## Bordes
ISBN de 9, 10, 13 y 14 dígitos · título de 0, 1, 200 y 201 caracteres · autor de 120 y 121 · `copies` 0, 1, 100 y 101 · `copies` decimal o texto · título solo con espacios.

## Fuera de alcance
Editar o retirar libros (F18–F19), categoría y año (F20), dígito verificador del ISBN (F22), contenido y copias digitales (F27).

## Preguntas abiertas
Ninguna.
