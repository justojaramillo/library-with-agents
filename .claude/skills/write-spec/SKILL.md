---
name: write-spec
description: Convierte una feature de docs/features.md en una especificación verificable en docs/specs/. Úsala antes de implementar cualquier feature (SDD).
---

# Escribir una especificación (SDD)

Una especificación es el contrato entre la persona y los agentes: lo que NO está escrito aquí, los agentes lo inventan.

## Pasos
1. Lee la feature en `docs/features.md`, los contratos (`app/features/<feature>/schema.ts`, `app/shared/schema.ts`) y una especificación terminada como modelo (`docs/specs/F2-buscar-libros.md`).
2. Copia `docs/specs/_template.md` a `docs/specs/<id>-<nombre-en-kebab>.md`.
3. Completa cada sección con reglas **comprobables** (un número, un estado, un error concreto). Evita "rápido", "seguro", "amigable".
4. Cada regla de negocio debe tener al menos un criterio de aceptación en formato Dado/Cuando/Entonces.
5. Lista como **preguntas abiertas** todo lo que no esté decidido. No las respondas por tu cuenta: pregúntalas a la persona.
6. Marca el estado `Borrador`. Solo la persona lo cambia a `Aprobada`.

## Revisión rápida antes de entregar
- ¿Un agente de pruebas podría escribir las pruebas leyendo solo este archivo?
- ¿Están los errores esperados (qué clase de error y cuándo)?
- ¿Está dicho quién SÍ y quién NO puede hacer la operación?
- ¿Están los bordes (0, 1, límite, límite + 1, vacío)?
