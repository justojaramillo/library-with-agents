import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiErrorSchema } from "@/shared/schema";
import { resetRateLimits } from "@/shared/server/security/rate-limit";
import { makeTeacherWorld, NOTE, type Person, T0, type TeacherWorld } from "@/tests/helpers/teacher-requests";
import { CreateTeacherRequestInputSchema, RejectTeacherRequestInputSchema } from "../schema";
import { POST as createRoute } from "@/api/me/teacher-request/route";
import { POST as rejectRoute } from "@/api/teacher-requests/[id]/reject/route";

/**
 * F37 · regla 14: `note` y `reason` rechazan los caracteres de control (salvo `\n`), los de ancho cero y las marcas
 * de dirección, con el mensaje «No uses caracteres de control ni invisibles.». La comprobación se hace sobre el texto
 * ya recortado y antes de contar la longitud mínima.
 */

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const holder = vi.hoisted(() => ({
  world: null as TeacherWorld | null,
  uid: undefined as string | undefined,
}));

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => {
      if (holder.uid === undefined) {
        return undefined;
      }
      return { value: "cookie-valida" };
    },
  }),
}));

vi.mock("@/shared/server/firebase", () => ({
  getAdminAuth: () => ({
    verifySessionCookie: async () => {
      if (holder.uid === undefined) {
        throw Object.assign(new Error("sin sesión"), { code: "auth/session-cookie-expired" });
      }
      return { uid: holder.uid };
    },
  }),
  getAdminDb: () => ({
    collection: () => ({
      doc: (uid: string) => ({
        get: async () => {
          const row = await holder.world?.accounts.findById(uid);
          if (row === undefined) {
            return { exists: false, data: () => undefined };
          }
          return { exists: true, data: () => ({ role: row.role, active: row.active }) };
        },
      }),
    }),
  }),
}));

vi.mock("@/features/container", () => ({
  getContainer: () => {
    if (holder.world === null) {
      throw new Error("la prueba no preparó el mundo");
    }
    return { teacherRequests: holder.world.service };
  },
}));

const MESSAGE = "No uses caracteres de control ni invisibles.";
const VALID_NOTE = "Docente de Ingeniería";
const VALID_REASON = "No pudimos comprobarlo";
const JSON_HEADERS = { "content-type": "application/json", origin: "http://localhost" };

/** Los caracteres de `from` a `to` (ambos incluidos), cada uno con su etiqueta «U+XXXX». */
function range(from: number, to: number): [string, string][] {
  const out: [string, string][] = [];
  for (let code = from; code <= to; code += 1) {
    out.push([label(code), String.fromCodePoint(code)]);
  }
  return out;
}

function label(code: number): string {
  return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
}

function one(code: number): [string, string] {
  return [label(code), String.fromCodePoint(code)];
}

/** Controles C0 (sin el salto de línea) y C1, más ancho cero, dirección y FEFF: todo lo que la regla 14 prohíbe. */
const FORBIDDEN: [string, string][] = [
  ...range(0x0000, 0x0009),
  ...range(0x000b, 0x001f),
  ...range(0x007f, 0x009f),
  ...range(0x200b, 0x200f),
  ...range(0x202a, 0x202e),
  ...range(0x2060, 0x2064),
  ...range(0x2066, 0x2069),
  one(0xfeff),
];

/** Los que pide la tarea de forma explícita (un subconjunto de FORBIDDEN, para un recuento legible). */
const NAMED: [string, string][] = [
  0x0000, 0x0008, 0x0009, 0x000b, 0x000d, 0x001f, 0x007f, 0x0080, 0x009f, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f,
  0x202a, 0x202e, 0x2060, 0x2064, 0x2066, 0x2069, 0xfeff,
].map(one);

/** Caracteres que el recorte de `String.trim` quita de los extremos (tabulador, VT, CR, FEFF…). */
function isTrimmedAtEnds(character: string): boolean {
  return character.trim() === "";
}

const EDGE_SAFE = FORBIDDEN.filter(([, character]) => !isTrimmedAtEnds(character));
const EDGE_TRIMMED = FORBIDDEN.filter(([, character]) => isTrimmedAtEnds(character));

function messagesOf(result: { success: boolean; error?: { issues: { message: string }[] } }): string[] {
  if (result.success || result.error === undefined) {
    return [];
  }
  return result.error.issues.map((issue) => issue.message);
}

function noteResult(note: string) {
  return CreateTeacherRequestInputSchema.safeParse({ note });
}

function reasonResult(reason: string) {
  return RejectTeacherRequestInputSchema.safeParse({ reason });
}

function expectNoteRejected(note: string) {
  const result = noteResult(note);
  expect(result.success).toBe(false);
  expect(messagesOf(result)).toContain(MESSAGE);
}

function expectReasonRejected(reason: string) {
  const result = reasonResult(reason);
  expect(result.success).toBe(false);
  expect(messagesOf(result)).toContain(MESSAGE);
}

describe("F37 · regla 14 · note · caracteres no permitidos (400 con el mensaje exacto)", () => {
  it.each(NAMED)("%s en medio de un texto válido se rechaza", (_label, character) => {
    expectNoteRejected(`${VALID_NOTE}${character}${VALID_NOTE}`);
  });

  it.each(NAMED)("%s pegado a un texto válido, sin espacios alrededor, se rechaza", (_label, character) => {
    expectNoteRejected(`Docente${character}de Ingeniería`);
  });

  it.each(EDGE_SAFE)("%s al inicio de un texto válido se rechaza", (_label, character) => {
    expectNoteRejected(`${character}${VALID_NOTE}`);
  });

  it.each(EDGE_SAFE)("%s al final de un texto válido se rechaza", (_label, character) => {
    expectNoteRejected(`${VALID_NOTE}${character}`);
  });

  it.each(FORBIDDEN)("%s en medio de un texto válido se rechaza (todos los rangos)", (_label, character) => {
    expectNoteRejected(`${VALID_NOTE} ${character} ${VALID_NOTE}`);
  });

  it("un solo carácter oculto en un texto largo (499 válidos + 1) se rechaza aunque la longitud cuadre", () => {
    expectNoteRejected(`${"n".repeat(499)}​`);
  });

  it("varios caracteres distintos a la vez se rechazan con un único mensaje claro", () => {
    const result = noteResult(`${VALID_NOTE}​‮\u0000${VALID_NOTE}`);

    expect(result.success).toBe(false);
    expect(messagesOf(result)).toContain(MESSAGE);
  });

  it("el carácter oculto en un texto válido no deja pasar el mensaje de longitud como único error", () => {
    const result = noteResult(`${VALID_NOTE}​`);

    expect(messagesOf(result)).toEqual([MESSAGE]);
  });
});

describe("F37 · regla 14 · note · los caracteres de los extremos se recortan antes de comprobar", () => {
  it.each(
    EDGE_TRIMMED,
  )("%s (espacio para el recorte) al inicio o al final se quita y el texto válido pasa recortado", (_label, character) => {
    const result = noteResult(`${character}${VALID_NOTE}${character}`);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.note).toBe(VALID_NOTE);
    }
  });

  it.each(EDGE_TRIMMED)("%s en medio del texto sí se rechaza", (_label, character) => {
    expectNoteRejected(`${VALID_NOTE}${character}${VALID_NOTE}`);
  });
});

describe("F37 · regla 14 · note · lo que sí se acepta", () => {
  it("el salto de línea (\\n) dentro de la nota", () => {
    const result = noteResult("Docente de Ingeniería\nUniversidad Nacional\nSede Bogotá");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.note).toBe("Docente de Ingeniería\nUniversidad Nacional\nSede Bogotá");
    }
  });

  it("varios saltos de línea seguidos en el medio se conservan", () => {
    expect(noteResult("Primera línea\n\n\nTercera línea").success).toBe(true);
  });

  it("tildes, ñ y diéresis", () => {
    expect(noteResult("Cátedra de Ingeniería, año pingüino ÁÉÍÓÚ").success).toBe(true);
  });

  it("emojis", () => {
    expect(noteResult("Docente de Física 😀 y Química 🧪 🎓").success).toBe(true);
  });

  it("consecuencia de la regla: un emoji compuesto con U+200D (👩‍🏫) se rechaza", () => {
    expectNoteRejected("Docente de Física 👩\u200D🏫 de la sede");
  });

  it("espacios normales repetidos en el medio", () => {
    expect(noteResult("Docente    de    Ingeniería").success).toBe(true);
  });

  it("el espacio de no separación U+00A0 en el medio (la spec no lo lista)", () => {
    expect(noteResult(`Docente${" "}de${" "}Ingeniería`).success).toBe(true);
  });

  it.each([
    one(0x0020),
    one(0x007e),
    one(0x00a0),
    one(0x00a1),
    one(0x2010),
    one(0x205f),
    one(0x2065),
    one(0x2070),
    one(0xfefe),
    one(0xff00),
  ])("el carácter vecino de un rango, %s, en medio del texto, pasa", (_label, character) => {
    expect(noteResult(`${VALID_NOTE}${character}${VALID_NOTE}`).success).toBe(true);
  });

  it("los vecinos de cada rango (justo antes y justo después) pasan", () => {
    const neighbours = [0x0020, 0x007e, 0x00a0, 0x2010, 0x2029, 0x205f, 0x2065, 0x206a, 0xfefe];

    for (const code of neighbours) {
      const text = `${VALID_NOTE}${String.fromCodePoint(code)}${VALID_NOTE}`;
      expect(noteResult(text).success, label(code)).toBe(true);
    }
  });
});

describe("F37 · regla 14 · note · el hallazgo: el control va antes del mínimo de longitud", () => {
  it("10 × U+200B se rechaza (antes pasaba el mínimo)", () => {
    expectNoteRejected("​".repeat(10));
  });

  it("10 × U+200B con texto válido alrededor del medio también", () => {
    expectNoteRejected(`${"a".repeat(5)}${"​".repeat(10)}${"b".repeat(5)}`);
  });

  it("9 caracteres válidos + 1 oculto (suman 10) se rechaza", () => {
    expectNoteRejected(`${"n".repeat(9)}​`);
    expectNoteRejected(`${"n".repeat(4)}​${"n".repeat(5)}`);
  });

  it("10 caracteres válidos se aceptan", () => {
    expect(noteResult("n".repeat(10)).success).toBe(true);
  });

  it("9 caracteres válidos se rechazan por longitud (no por caracteres ocultos)", () => {
    const result = noteResult("n".repeat(9));

    expect(result.success).toBe(false);
    expect(messagesOf(result)).not.toContain(MESSAGE);
  });

  it("500 válidos pasa, 501 falla", () => {
    expect(noteResult("n".repeat(500)).success).toBe(true);
    expect(noteResult("n".repeat(501)).success).toBe(false);
  });

  it("500 caracteres con uno oculto en el medio se rechaza", () => {
    expectNoteRejected(`${"n".repeat(250)}​${"n".repeat(249)}`);
  });

  it("un texto con solo saltos de línea y espacios se recorta y falla por longitud (no por caracteres)", () => {
    const result = noteResult("  \n\n  \n  ");

    expect(result.success).toBe(false);
    expect(messagesOf(result)).not.toContain(MESSAGE);
  });

  it("un salto de línea entre palabras no cuenta como carácter oculto", () => {
    expect(messagesOf(noteResult("corta\nnota"))).toEqual([]);
    expect(noteResult("corta\nnota").success).toBe(true);
  });

  it("sin nota o con una nota que no es texto sigue fallando", () => {
    expect(CreateTeacherRequestInputSchema.safeParse({}).success).toBe(false);
    expect(CreateTeacherRequestInputSchema.safeParse({ note: 12345 }).success).toBe(false);
  });
});

describe("F37 · regla 14 · reason · caracteres no permitidos (400 con el mensaje exacto)", () => {
  it.each(NAMED)("%s en medio de un motivo válido se rechaza", (_label, character) => {
    expectReasonRejected(`${VALID_REASON}${character}${VALID_REASON}`);
  });

  it.each(NAMED)("%s pegado a un motivo válido, sin espacios alrededor, se rechaza", (_label, character) => {
    expectReasonRejected(`No${character}pudimos`);
  });

  it.each(EDGE_SAFE)("%s al inicio de un motivo válido se rechaza", (_label, character) => {
    expectReasonRejected(`${character}${VALID_REASON}`);
  });

  it.each(EDGE_SAFE)("%s al final de un motivo válido se rechaza", (_label, character) => {
    expectReasonRejected(`${VALID_REASON}${character}`);
  });

  it.each(FORBIDDEN)("%s en medio de un motivo válido se rechaza (todos los rangos)", (_label, character) => {
    expectReasonRejected(`${VALID_REASON} ${character} ${VALID_REASON}`);
  });

  it("un motivo que es solo un carácter oculto se rechaza", () => {
    expectReasonRejected("​");
    expectReasonRejected("‮");
  });

  it.each(EDGE_TRIMMED)("%s (espacio para el recorte) en los extremos equivale a motivo vacío", (_label, character) => {
    const result = reasonResult(`${character}${character}`);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reason).toBeUndefined();
    }
  });
});

describe("F37 · regla 14 · reason · lo que sí se acepta y los bordes de longitud", () => {
  it("el salto de línea (\\n) dentro del motivo", () => {
    const result = reasonResult("Falta el carné\nVuelve a intentarlo");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reason).toBe("Falta el carné\nVuelve a intentarlo");
    }
  });

  it("tildes, ñ, emojis, espacios normales y U+00A0", () => {
    expect(reasonResult("Año académico 😀 sin soporte").success).toBe(true);
    expect(reasonResult(`Sin${" "}soporte`).success).toBe(true);
  });

  it.each([one(0x2010), one(0x205f), one(0x2065), one(0xfefe)])("%s en medio pasa", (_label, character) => {
    expect(reasonResult(`Sin${character}soporte`).success).toBe(true);
  });

  it("la cadena vacía equivale a ausente", () => {
    const result = reasonResult("");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reason).toBeUndefined();
    }
  });

  it("solo espacios equivale a ausente", () => {
    const result = reasonResult("     ");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reason).toBeUndefined();
    }
  });

  it("solo saltos de línea y espacios equivale a ausente", () => {
    const result = reasonResult(" \n \n ");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reason).toBeUndefined();
    }
  });

  it("sin el campo `reason` también es válido", () => {
    const result = RejectTeacherRequestInputSchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reason).toBeUndefined();
    }
  });

  it("1 carácter válido pasa", () => {
    expect(reasonResult("x").success).toBe(true);
  });

  it("300 válidos pasa", () => {
    expect(reasonResult("m".repeat(300)).success).toBe(true);
  });

  it("301 válidos falla", () => {
    expect(reasonResult("m".repeat(301)).success).toBe(false);
  });

  it("300 caracteres con uno oculto falla", () => {
    expectReasonRejected(`${"m".repeat(299)}​`);
    expectReasonRejected(`${"m".repeat(150)}‮${"m".repeat(149)}`);
  });

  it("300 válidos más espacios alrededor pasan (el recorte va antes de contar)", () => {
    const result = reasonResult(` ${"m".repeat(300)} `);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reason).toHaveLength(300);
    }
  });
});

function jsonRequest(url: string, body: Json): NextRequest {
  return new NextRequest(url, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
}

function postMyNote(note: string) {
  return createRoute(jsonRequest("http://localhost/api/me/teacher-request", { note }));
}

function postReject(id: string, reason: string) {
  const url = `http://localhost/api/teacher-requests/${encodeURIComponent(id)}/reject`;
  return rejectRoute(jsonRequest(url, { reason }), { params: Promise.resolve({ id }) });
}

function currentWorld(): TeacherWorld {
  if (holder.world === null) {
    throw new Error("sin mundo");
  }
  return holder.world;
}

/** Los mensajes de los problemas de validación (`issues`) del cuerpo de un 400. */
async function issueMessagesOf(response: Response): Promise<string[]> {
  const issues = ApiErrorSchema.parse(await response.json()).issues ?? [];
  return issues.map((issue) => issue.message);
}

async function signIn(role: "ESTUDIANTE" | "BIBLIOTECARIO"): Promise<Person> {
  const person = await currentWorld().addPerson(role);
  holder.uid = person.id;
  return person;
}

beforeEach(() => {
  resetRateLimits();
  holder.world = makeTeacherWorld();
  holder.uid = undefined;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("F37 · regla 14 · por la ruta HTTP", () => {
  it("POST /api/me/teacher-request con una nota con U+200B responde 400 con el mensaje y no crea nada", async () => {
    const person = await signIn("ESTUDIANTE");

    const response = await postMyNote(`${VALID_NOTE}​${VALID_NOTE}`);

    expect(response.status).toBe(400);
    expect(await issueMessagesOf(response)).toContain(MESSAGE);
    expect(await currentWorld().requests.get(person.id)).toBeUndefined();
  });

  it("POST /api/me/teacher-request con 10 × U+200B responde 400", async () => {
    const person = await signIn("ESTUDIANTE");

    const response = await postMyNote("​".repeat(10));

    expect(response.status).toBe(400);
    expect(await currentWorld().requests.get(person.id)).toBeUndefined();
  });

  it("POST /api/me/teacher-request con una nota válida con salto de línea sigue dando 201", async () => {
    await signIn("ESTUDIANTE");

    const response = await postMyNote("Docente de Ingeniería\nUniversidad Nacional");

    expect(response.status).toBe(201);
  });

  it("tras el 400 la persona puede enviar una nota válida (no quedó nada bloqueado)", async () => {
    await signIn("ESTUDIANTE");
    await postMyNote(`${VALID_NOTE}‮`);

    const response = await postMyNote(NOTE);

    expect(response.status).toBe(201);
  });

  it("POST /api/teacher-requests/:id/reject con un motivo con U+202E responde 400 y la solicitud sigue PENDIENTE", async () => {
    const person = await currentWorld().addPerson("ESTUDIANTE");
    await currentWorld().ask(person);
    await signIn("BIBLIOTECARIO");

    const response = await postReject(person.id, `No pudimos${"‮"} comprobarlo`);

    expect(response.status).toBe(400);
    expect(await issueMessagesOf(response)).toContain(MESSAGE);
    const stored = await currentWorld().requests.get(person.id);
    expect(stored?.status).toBe("PENDIENTE");
    expect(stored?.reason).toBeNull();
    expect(stored?.decided_at).toBeNull();
    expect(stored?.decided_by).toBeNull();
  });

  it("el rechazo con motivo inválido no cambia la nota guardada ni el rol de la persona", async () => {
    const person = await currentWorld().addPerson("ESTUDIANTE");
    await currentWorld().ask(person);
    const before = await currentWorld().requests.get(person.id);
    await signIn("BIBLIOTECARIO");

    await postReject(person.id, `${VALID_REASON}​`);

    expect(await currentWorld().requests.get(person.id)).toEqual(before);
    expect((await currentWorld().requests.get(person.id))?.note).toBe(NOTE);
    expect(await currentWorld().roleOf(person)).toBe("ESTUDIANTE");
  });

  it("tras el 400, el mismo motivo sin el carácter oculto sí rechaza la solicitud", async () => {
    const person = await currentWorld().addPerson("ESTUDIANTE");
    await currentWorld().ask(person);
    await signIn("BIBLIOTECARIO");
    await postReject(person.id, `${VALID_REASON}​`);

    const response = await postReject(person.id, VALID_REASON);

    expect(response.status).toBe(200);
    expect((await currentWorld().requests.get(person.id))?.status).toBe("RECHAZADA");
  });

  it("un motivo con salto de línea se acepta por la ruta", async () => {
    const person = await currentWorld().addPerson("ESTUDIANTE");
    await currentWorld().ask(person);
    await signIn("BIBLIOTECARIO");

    const response = await postReject(person.id, "Falta el carné\nVuelve a intentarlo");

    expect(response.status).toBe(200);
    expect((await currentWorld().requests.get(person.id))?.reason).toBe("Falta el carné\nVuelve a intentarlo");
  });
});
