import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { readBodyText } from "@/shared/server/security/body-limit";

/** Tope de la spec F27 (regla 11) para el cuerpo del PUT de contenido digital. */
const TOPE = 4_200_000;

const encoder = new TextEncoder();

interface Seguimiento {
  /** Veces que el lector pidió un trozo al origen del cuerpo. */
  pulls: number;
  /** Veces que se canceló el flujo. */
  cancelaciones: number;
}

interface CuerpoSeguido {
  stream: ReadableStream<Uint8Array>;
  seguimiento: Seguimiento;
}

/** Flujo que entrega un trozo por lectura (sin adelantarse) y cuenta lecturas y cancelaciones. */
function flujo(trozos: Uint8Array[]): CuerpoSeguido {
  const seguimiento: Seguimiento = { pulls: 0, cancelaciones: 0 };
  let siguiente = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        seguimiento.pulls += 1;
        const trozo = trozos[siguiente];
        siguiente += 1;
        if (trozo === undefined) {
          controller.close();
          return;
        }
        controller.enqueue(trozo);
      },
      cancel() {
        seguimiento.cancelaciones += 1;
      },
    },
    new CountQueuingStrategy({ highWaterMark: 0 }),
  );
  return { stream, seguimiento };
}

/** `RequestInit` con `duplex`, que Node exige para cuerpos en flujo y los tipos de DOM aún no declaran. */
interface InitConFlujo extends RequestInit {
  duplex: "half";
}

/** Petición PUT con cuerpo en trozos y, si se pide, un `content-length` declarado. */
function peticion(cuerpo: CuerpoSeguido, contentLength?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (contentLength !== undefined) {
    headers.set("content-length", contentLength);
  }
  const init: InitConFlujo = { method: "PUT", headers, body: cuerpo.stream, duplex: "half" };
  return new Request("https://biblioteca.example.com/api/books/b1/digital/content", init);
}

/** Parte unos bytes en trozos del tamaño pedido. */
function partir(bytes: Uint8Array, tamano: number): Uint8Array[] {
  const trozos: Uint8Array[] = [];
  for (let inicio = 0; inicio < bytes.byteLength; inicio += tamano) {
    trozos.push(bytes.slice(inicio, inicio + tamano));
  }
  return trozos;
}

interface Rechazo {
  esZod: boolean;
  mensaje: string;
}

/** Resume un error capturado: si es de validación de Zod (se traduce a 400) y sus mensajes. */
function resumir<T>(error: T): Rechazo {
  if (error instanceof ZodError) {
    return { esZod: true, mensaje: error.issues.map((issue) => issue.message).join(" ") };
  }
  return { esZod: false, mensaje: "" };
}

/** Captura el rechazo de una promesa para inspeccionarlo; `undefined` si no se rechazó. */
async function rechazo(promesa: Promise<string>): Promise<Rechazo | undefined> {
  try {
    await promesa;
  } catch (error) {
    return resumir(error);
  }
  return undefined;
}

describe("Seguridad · lectura del cuerpo con tope (F27, regla 11)", () => {
  describe("content-length declarado por encima del tope", () => {
    it("rechaza con un error de validación (400) sin leer el cuerpo", async () => {
      const cuerpo = flujo([encoder.encode("hola")]);
      const error = await rechazo(readBodyText(peticion(cuerpo, String(TOPE + 1)), TOPE));
      expect(error?.esZod).toBe(true);
      expect(cuerpo.seguimiento.pulls).toBe(0);
    });

    it("el mensaje del rechazo dice que el cuerpo es demasiado grande", async () => {
      const cuerpo = flujo([encoder.encode("hola")]);
      const error = await rechazo(readBodyText(peticion(cuerpo, "5000000"), TOPE));
      expect(error?.mensaje).toContain("El cuerpo de la petición es demasiado grande.");
    });

    it("declarar exactamente el tope no se rechaza de antemano", async () => {
      const cuerpo = flujo([encoder.encode("hola")]);
      const texto = await readBodyText(peticion(cuerpo, String(TOPE)), TOPE);
      expect(texto).toBe("hola");
    });
  });

  describe("cuerpo troceado sin content-length que supera el tope", () => {
    it("se rechaza (400) y se cancela el lector", async () => {
      const cuerpo = flujo(partir(encoder.encode("a".repeat(30)), 10));
      const error = await rechazo(readBodyText(peticion(cuerpo), 25));
      expect(error?.esZod).toBe(true);
      expect(cuerpo.seguimiento.cancelaciones).toBe(1);
    });

    it("corta en el trozo que cruza el tope y no pide más", async () => {
      const cuerpo = flujo(partir(encoder.encode("a".repeat(1000)), 10));
      await rechazo(readBodyText(peticion(cuerpo), 25));
      // Trozos de 10 bytes: tras 3 lecturas hay 30 > 25; no se sigue acumulando el resto.
      expect(cuerpo.seguimiento.pulls).toBeLessThanOrEqual(3);
    });

    it("un solo trozo mayor que el tope también se rechaza", async () => {
      const cuerpo = flujo([encoder.encode("a".repeat(26))]);
      const error = await rechazo(readBodyText(peticion(cuerpo), 25));
      expect(error?.esZod).toBe(true);
      expect(cuerpo.seguimiento.cancelaciones).toBe(1);
    });

    it("con el tope real, un cuerpo de tope + 1 bytes se rechaza", async () => {
      const cuerpo = flujo(partir(encoder.encode("a".repeat(TOPE + 1)), 65_536));
      const error = await rechazo(readBodyText(peticion(cuerpo), TOPE));
      expect(error?.esZod).toBe(true);
      expect(cuerpo.seguimiento.cancelaciones).toBe(1);
    });
  });

  describe("content-length mentiroso", () => {
    it("declara poco pero envía más que el tope: se rechaza igualmente", async () => {
      const cuerpo = flujo(partir(encoder.encode("a".repeat(100)), 10));
      const error = await rechazo(readBodyText(peticion(cuerpo, "5"), 25));
      expect(error?.esZod).toBe(true);
      expect(cuerpo.seguimiento.cancelaciones).toBe(1);
    });

    it("declara 0 pero envía más que el tope: se rechaza igualmente", async () => {
      const cuerpo = flujo(partir(encoder.encode("a".repeat(100)), 10));
      const error = await rechazo(readBodyText(peticion(cuerpo, "0"), 25));
      expect(error?.esZod).toBe(true);
    });
  });

  describe("cuerpo dentro del tope", () => {
    it("un cuerpo justo en el tope se lee completo", async () => {
      const texto = "a".repeat(25);
      const cuerpo = flujo(partir(encoder.encode(texto), 10));
      expect(await readBodyText(peticion(cuerpo), 25)).toBe(texto);
    });

    it("un cuerpo un byte por debajo del tope se lee completo", async () => {
      const texto = "a".repeat(24);
      const cuerpo = flujo(partir(encoder.encode(texto), 10));
      expect(await readBodyText(peticion(cuerpo), 25)).toBe(texto);
    });

    it("un cuerpo de un byte sobre el tope se rechaza (límite + 1)", async () => {
      const cuerpo = flujo(partir(encoder.encode("a".repeat(26)), 10));
      const error = await rechazo(readBodyText(peticion(cuerpo), 25));
      expect(error?.esZod).toBe(true);
    });

    it("con el tope real, un cuerpo justo en 4 200 000 bytes se lee completo", async () => {
      const texto = "a".repeat(TOPE);
      const cuerpo = flujo(partir(encoder.encode(texto), 65_536));
      const leido = await readBodyText(peticion(cuerpo, String(TOPE)), TOPE);
      expect(leido.length).toBe(TOPE);
    });

    it("el tope se mide en bytes, no en caracteres: 'á' pesa 2 bytes", async () => {
      // 13 caracteres de 2 bytes = 26 bytes > 25, aunque tenga menos de 25 caracteres.
      const cuerpo = flujo(partir(encoder.encode("á".repeat(13)), 4));
      const error = await rechazo(readBodyText(peticion(cuerpo), 25));
      expect(error?.esZod).toBe(true);
    });

    it("decodifica tildes y eñes en UTF-8", async () => {
      const texto = "Canción de la niña: áéíóú ñ";
      const cuerpo = flujo([encoder.encode(texto)]);
      expect(await readBodyText(peticion(cuerpo), TOPE)).toBe(texto);
    });

    it("decodifica bien caracteres partidos byte a byte entre trozos", async () => {
      const texto = "á é ñ 😀 日本 🎉";
      const cuerpo = flujo(partir(encoder.encode(texto), 1));
      expect(await readBodyText(peticion(cuerpo), TOPE)).toBe(texto);
    });

    it("decodifica un emoji partido por la mitad entre dos trozos", async () => {
      const bytes = encoder.encode("a😀b");
      const cuerpo = flujo([bytes.slice(0, 3), bytes.slice(3)]);
      expect(await readBodyText(peticion(cuerpo), TOPE)).toBe("a😀b");
    });

    it("un content-length correcto no altera la lectura", async () => {
      const bytes = encoder.encode('{"markdown":"# Título"}');
      const cuerpo = flujo([bytes]);
      const leido = await readBodyText(peticion(cuerpo, String(bytes.byteLength)), TOPE);
      expect(leido).toBe('{"markdown":"# Título"}');
    });
  });

  describe("cuerpo vacío y content-length inválido", () => {
    it("un cuerpo vacío (sin flujo) devuelve texto vacío", async () => {
      const req = new Request("https://biblioteca.example.com/x", { method: "PUT" });
      expect(await readBodyText(req, TOPE)).toBe("");
    });

    it("un flujo que se cierra sin datos devuelve texto vacío", async () => {
      const cuerpo = flujo([]);
      expect(await readBodyText(peticion(cuerpo), TOPE)).toBe("");
    });

    it("un content-length no numérico se ignora y se aplica el tope sobre lo leído", async () => {
      const cuerpo = flujo([encoder.encode("hola")]);
      expect(await readBodyText(peticion(cuerpo, "abc"), TOPE)).toBe("hola");
    });

    it("un content-length no numérico no evita el rechazo de un cuerpo enorme", async () => {
      const cuerpo = flujo(partir(encoder.encode("a".repeat(100)), 10));
      const error = await rechazo(readBodyText(peticion(cuerpo, "abc"), 25));
      expect(error?.esZod).toBe(true);
    });

    it("un content-length negativo se ignora y se aplica el tope sobre lo leído", async () => {
      const cuerpo = flujo([encoder.encode("hola")]);
      expect(await readBodyText(peticion(cuerpo, "-5"), TOPE)).toBe("hola");
    });

    it("un content-length negativo no evita el rechazo de un cuerpo enorme", async () => {
      const cuerpo = flujo(partir(encoder.encode("a".repeat(100)), 10));
      const error = await rechazo(readBodyText(peticion(cuerpo, "-5"), 25));
      expect(error?.esZod).toBe(true);
    });
  });
});
