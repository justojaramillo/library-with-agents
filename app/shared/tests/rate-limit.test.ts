import { beforeEach, describe, expect, it } from "vitest";
import { TooManyRequestsError } from "@/shared/server/errors";
import { clientKey, enforceRateLimit, RATE_LIMITS, resetRateLimits } from "@/shared/server/security/rate-limit";

const T0 = new Date("2026-01-10T10:00:00.000Z");
const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs);

/** Hace `count` peticiones seguidas en el mismo instante. */
function hit(bucket: "catalogSearch" | "memberSearch", key: string, count: number, now: Date) {
  for (let i = 0; i < count; i += 1) {
    enforceRateLimit(bucket, key, now);
  }
}

/** El error que lanza la petición, o `undefined` si pasó. */
function outcome(bucket: "catalogSearch" | "memberSearch", key: string, now: Date) {
  try {
    enforceRateLimit(bucket, key, now);
  } catch (error) {
    if (error instanceof TooManyRequestsError) {
      return error;
    }
    throw error;
  }
  return undefined;
}

beforeEach(() => {
  resetRateLimits();
});

describe("S1 · límites por cubo (ADR-0008)", () => {
  it("la búsqueda de catálogo admite 60 por minuto y la de personas 30 por minuto", () => {
    expect(RATE_LIMITS.catalogSearch).toEqual({ limit: 60, windowMs: 60_000 });
    expect(RATE_LIMITS.memberSearch).toEqual({ limit: 30, windowMs: 60_000 });
  });
});

describe("S1 · enforceRateLimit", () => {
  it("la petición número 60 de catálogo pasa y la 61 recibe 429", () => {
    hit("catalogSearch", "1.2.3.4", 60, T0);

    const error = outcome("catalogSearch", "1.2.3.4", T0);

    expect(error).toBeInstanceOf(TooManyRequestsError);
  });

  it("la petición número 30 de personas pasa y la 31 recibe 429", () => {
    hit("memberSearch", "m-1", 30, T0);

    expect(outcome("memberSearch", "m-1", T0)).toBeInstanceOf(TooManyRequestsError);
  });

  it("la primera petición pasa (borde: límite 1 de 60)", () => {
    expect(outcome("catalogSearch", "1.2.3.4", T0)).toBeUndefined();
  });

  it("el 429 indica cuántos segundos faltan para que cierre la ventana", () => {
    hit("catalogSearch", "ip", 60, T0);

    expect(outcome("catalogSearch", "ip", at(10_000))?.retryAfterSeconds).toBe(50);
  });

  it("retryAfterSeconds nunca baja de 1, ni a medio segundo del cierre", () => {
    hit("catalogSearch", "ip", 60, T0);

    expect(outcome("catalogSearch", "ip", at(59_500))?.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(outcome("catalogSearch", "ip", at(59_999))?.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("un milisegundo antes del cambio de ventana todavía se rechaza", () => {
    hit("catalogSearch", "ip", 60, T0);

    expect(outcome("catalogSearch", "ip", at(59_999))).toBeInstanceOf(TooManyRequestsError);
  });

  it("en el instante exacto del cambio de ventana se abre una ventana nueva y la petición pasa", () => {
    hit("catalogSearch", "ip", 60, T0);

    expect(outcome("catalogSearch", "ip", at(60_000))).toBeUndefined();
  });

  it("la ventana nueva vuelve a contar desde cero: 60 pasan y la 61 se rechaza", () => {
    hit("catalogSearch", "ip", 60, T0);
    hit("catalogSearch", "ip", 60, at(60_000));

    expect(outcome("catalogSearch", "ip", at(60_000))).toBeInstanceOf(TooManyRequestsError);
  });

  it("pasado el minuto vuelve a responder", () => {
    hit("memberSearch", "m-1", 30, T0);
    expect(outcome("memberSearch", "m-1", at(1_000))).toBeInstanceOf(TooManyRequestsError);

    expect(outcome("memberSearch", "m-1", at(61_000))).toBeUndefined();
  });

  it("las claves distintas no se afectan: una IP agotada no bloquea a otra", () => {
    hit("catalogSearch", "1.1.1.1", 60, T0);
    expect(outcome("catalogSearch", "1.1.1.1", T0)).toBeInstanceOf(TooManyRequestsError);

    expect(outcome("catalogSearch", "2.2.2.2", T0)).toBeUndefined();
  });

  it("dos miembros del personal tienen contadores independientes", () => {
    hit("memberSearch", "bibliotecario-1", 30, T0);

    expect(outcome("memberSearch", "bibliotecario-1", T0)).toBeInstanceOf(TooManyRequestsError);
    expect(outcome("memberSearch", "bibliotecario-2", T0)).toBeUndefined();
  });

  it("los cubos distintos no se afectan aunque la clave sea la misma", () => {
    hit("memberSearch", "misma", 30, T0);
    expect(outcome("memberSearch", "misma", T0)).toBeInstanceOf(TooManyRequestsError);

    expect(outcome("catalogSearch", "misma", T0)).toBeUndefined();
  });

  it("un cubo no puede confundirse con otro por la forma de la clave", () => {
    hit("catalogSearch", "x", 60, T0);

    expect(outcome("memberSearch", "catalogSearch|x", T0)).toBeUndefined();
  });

  it("al rechazar no se consume más: seguir insistiendo no alarga la espera", () => {
    hit("catalogSearch", "ip", 60, T0);
    for (let i = 0; i < 20; i += 1) {
      outcome("catalogSearch", "ip", at(1_000));
    }

    expect(outcome("catalogSearch", "ip", at(60_000))).toBeUndefined();
  });
});

describe("S1 · limpieza de claves vencidas", () => {
  it("con miles de claves vencidas, una clave vencida y una nueva se comportan como nuevas", () => {
    for (let i = 0; i < 2_500; i += 1) {
      enforceRateLimit("catalogSearch", `ip-${i}`, T0);
    }
    hit("catalogSearch", "ip-0", 59, T0);

    hit("catalogSearch", "ip-0", 60, at(61_000));
    expect(outcome("catalogSearch", "ip-0", at(61_000))).toBeInstanceOf(TooManyRequestsError);
    expect(outcome("catalogSearch", "ip-nueva", at(61_000))).toBeUndefined();
  });

  it("la limpieza no borra una clave agotada cuya ventana sigue abierta", () => {
    hit("catalogSearch", "caliente", 60, T0);
    for (let i = 0; i < 2_500; i += 1) {
      enforceRateLimit("catalogSearch", `otra-${i}`, at(30_000));
    }

    expect(outcome("catalogSearch", "caliente", at(31_000))).toBeInstanceOf(TooManyRequestsError);
  });
});

describe("S1 · clientKey", () => {
  const withHeader = (value: string) =>
    new Request("http://localhost/api/books", { headers: { "x-forwarded-for": value } });

  it("toma la primera IP de x-forwarded-for", () => {
    expect(clientKey(withHeader("203.0.113.7, 10.0.0.1, 10.0.0.2"))).toBe("203.0.113.7");
  });

  it("recorta los espacios", () => {
    expect(clientKey(withHeader("   203.0.113.7  , 10.0.0.1"))).toBe("203.0.113.7");
  });

  it("con una sola IP, esa", () => {
    expect(clientKey(withHeader("198.51.100.4"))).toBe("198.51.100.4");
  });

  it("sin la cabecera la clave es «desconocida»", () => {
    expect(clientKey(new Request("http://localhost/api/books"))).toBe("desconocida");
  });

  it("con la cabecera vacía la clave es «desconocida»", () => {
    expect(clientKey(withHeader(""))).toBe("desconocida");
    expect(clientKey(withHeader("   "))).toBe("desconocida");
  });

  it("las peticiones sin IP no se limitan nunca (S1 regla 12): 200 llamadas sin error", () => {
    const unknown = clientKey(new Request("http://localhost/a"));

    expect(unknown).toBe("desconocida");
    for (let i = 0; i < 200; i += 1) {
      expect(outcome("catalogSearch", unknown, T0)).toBeUndefined();
    }
  });
});

describe("S1 regla 12 · clientKey: de dónde sale la IP", () => {
  const withHeaders = (headers: Record<string, string>) => new Request("http://localhost/api/books", { headers });
  const forwarded = (value: string) => withHeaders({ "x-forwarded-for": value });

  it("prefiere x-vercel-forwarded-for sobre x-forwarded-for", () => {
    const request = withHeaders({ "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "198.51.100.4" });

    expect(clientKey(request)).toBe("203.0.113.7");
  });

  it("sin x-vercel-forwarded-for usa la primera IP de x-forwarded-for", () => {
    expect(clientKey(forwarded("198.51.100.4, 10.0.0.1"))).toBe("198.51.100.4");
  });

  it("de x-vercel-forwarded-for también toma solo la primera IP", () => {
    expect(clientKey(withHeaders({ "x-vercel-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });
});

describe("S1 regla 12 · clientKey: solo IPs válidas", () => {
  const forwarded = (value: string) =>
    new Request("http://localhost/api/books", { headers: { "x-forwarded-for": value } });

  it.each([
    ["un texto que no es una IP", "no-soy-una-ip"],
    ["una IPv4 con un octeto fuera de rango", "256.1.1.1"],
    ["una IPv4 incompleta", "1.2.3"],
    ["una IP con puerto", "1.2.3.4:8080"],
    ["un valor vacío", ""],
    ["solo espacios", "     "],
    ["un valor de 8000 caracteres", "a".repeat(8000)],
    ["una cabecera de 8000 dígitos", "1".repeat(8000)],
    ["un valor de 65 caracteres con apariencia de IPv6", `fe80::1%${"a".repeat(57)}`],
  ])("%s da la clave «desconocida»", (_name, value) => {
    expect(clientKey(forwarded(value))).toBe("desconocida");
  });

  it("un valor inválido al inicio de la lista da «desconocida» (no se salta a la siguiente IP)", () => {
    expect(clientKey(forwarded("basura, 203.0.113.7"))).toBe("desconocida");
  });

  it("una IPv4 válida se usa tal cual", () => {
    expect(clientKey(forwarded("203.0.113.7"))).toBe("203.0.113.7");
  });
});

describe("S1 regla 12 · clientKey: IPv6 por prefijo /64 e IPv4 mapeada", () => {
  const forwarded = (value: string) =>
    new Request("http://localhost/api/books", { headers: { "x-forwarded-for": value } });

  it("dos direcciones del mismo /64 dan la misma clave, aunque difieran en mayúsculas y ceros", () => {
    expect(clientKey(forwarded("2001:0DB8:0:1::ffff"))).toBe(clientKey(forwarded("2001:db8:0:1:aaaa::1")));
  });

  it("direcciones de /64 distintos dan claves distintas", () => {
    expect(clientKey(forwarded("2001:db8:0:1::1"))).not.toBe(clientKey(forwarded("2001:db8:0:2::1")));
  });

  it("una IPv6 válida no cae en «desconocida»", () => {
    expect(clientKey(forwarded("2001:db8:0:1::1"))).not.toBe("desconocida");
    expect(clientKey(forwarded("::1"))).not.toBe("desconocida");
  });

  it("una IPv4 mapeada (::ffff:1.2.3.4) da la clave de la IPv4", () => {
    expect(clientKey(forwarded("::ffff:1.2.3.4"))).toBe("1.2.3.4");
  });

  it("dos clientes del mismo /64 comparten contador: el segundo recibe el 429 que agotó el primero", () => {
    hit("catalogSearch", clientKey(forwarded("2001:db8:0:1::1")), 60, T0);

    expect(outcome("catalogSearch", clientKey(forwarded("2001:db8:0:1:ffff::9")), T0)).toBeInstanceOf(
      TooManyRequestsError,
    );
    expect(outcome("catalogSearch", clientKey(forwarded("2001:db8:0:2::1")), T0)).toBeUndefined();
  });
});

describe("S1 regla 12 · la clave «desconocida» no se limita", () => {
  it("200 llamadas con «desconocida» no lanzan error", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(outcome("catalogSearch", "desconocida", T0)).toBeUndefined();
    }
  });

  it("tampoco en el cubo de personas (límite 30)", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(outcome("memberSearch", "desconocida", T0)).toBeUndefined();
    }
  });
});

describe("S1 regla 12 · tope de 10 000 entradas", () => {
  /** Crea `count` claves distintas (una petición cada una) en el instante `now`. */
  function fill(count: number, now: Date) {
    for (let i = 0; i < count; i += 1) {
      enforceRateLimit("catalogSearch", `clave-${i}`, now);
    }
  }

  it("tras 20 000 claves distintas, la más antigua ya no tiene contador previo y la nueva se limita bien", () => {
    hit("catalogSearch", "clave-0", 59, T0);
    fill(20_000, T0);
    // clave-0 llevaba 60 peticiones; si el Map aún la recordara, ya estaría agotada.
    expect(outcome("catalogSearch", "clave-0", T0)).toBeUndefined();

    hit("catalogSearch", "clave-19999", 58, T0);

    expect(outcome("catalogSearch", "clave-19999", T0)).toBeUndefined();
    expect(outcome("catalogSearch", "clave-19999", T0)).toBeInstanceOf(TooManyRequestsError);
  });

  it("no se expulsa de más: una clave de la segunda mitad conserva su contador", () => {
    fill(15_000, T0);
    hit("catalogSearch", "clave-14999", 59, T0);
    fill(5_000, T0);

    expect(outcome("catalogSearch", "clave-14999", T0)).toBeInstanceOf(TooManyRequestsError);
  });

  it("con el Map lleno, antes de expulsar se barren las vencidas y una clave viva no se pierde", () => {
    // La clave viva se crea la primera (la más antigua) a los 50 s; las demás, vencidas a los 61 s.
    hit("catalogSearch", "viva", 60, at(50_000));
    for (let i = 0; i < 9_999; i += 1) {
      enforceRateLimit("catalogSearch", `vieja-${i}`, T0);
    }

    expect(outcome("catalogSearch", "nueva", at(61_000))).toBeUndefined();
    expect(outcome("catalogSearch", "viva", at(61_000))).toBeInstanceOf(TooManyRequestsError);
  });
});

describe("S1 · resetRateLimits", () => {
  it("reinicia todos los contadores: una clave agotada vuelve a pasar", () => {
    hit("catalogSearch", "ip", 60, T0);
    hit("memberSearch", "m-1", 30, T0);
    expect(outcome("catalogSearch", "ip", T0)).toBeInstanceOf(TooManyRequestsError);

    resetRateLimits();

    expect(outcome("catalogSearch", "ip", T0)).toBeUndefined();
    expect(outcome("memberSearch", "m-1", T0)).toBeUndefined();
  });
});

describe("S1 regla 12 · clientKey acepta cualquier objeto con headers.get", () => {
  const ipHeaders = { "x-forwarded-for": "203.0.113.7, 10.0.0.1" };

  it("con un Request", () => {
    expect(clientKey(new Request("http://localhost/a", { headers: ipHeaders }))).toBe("203.0.113.7");
  });

  it("con un objeto { headers } que lleva un Headers real", () => {
    expect(clientKey({ headers: new Headers(ipHeaders) })).toBe("203.0.113.7");
  });

  it("con un Headers real, x-vercel-forwarded-for gana a x-forwarded-for", () => {
    const headers = new Headers({ "x-vercel-forwarded-for": "198.51.100.4", "x-forwarded-for": "203.0.113.7" });

    expect(clientKey({ headers })).toBe("198.51.100.4");
  });

  it("con un doble mínimo que solo implementa get", () => {
    const values = new Map([["x-forwarded-for", "2001:db8:0:1::1"]]);
    const double = { headers: { get: (name: string) => values.get(name) ?? null } };

    expect(clientKey(double)).toBe(clientKey({ headers: new Headers({ "x-forwarded-for": "2001:db8:0:1::99" }) }));
    expect(clientKey(double)).not.toBe("desconocida");
  });

  it("un doble sin ninguna cabecera da «desconocida»", () => {
    expect(clientKey({ headers: { get: () => null } })).toBe("desconocida");
  });

  it("un Headers vacío da «desconocida»", () => {
    expect(clientKey({ headers: new Headers() })).toBe("desconocida");
  });

  it("un valor que no es IP en un Headers real da «desconocida»", () => {
    expect(clientKey({ headers: new Headers({ "x-forwarded-for": "no-soy-una-ip" }) })).toBe("desconocida");
  });
});
