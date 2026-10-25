import { beforeEach, describe, expect, it } from "vitest";
import { TooManyRequestsError } from "@/shared/server/errors";
import { clientKey, enforceRateLimit, RATE_LIMITS, resetRateLimits } from "@/shared/server/security/rate-limit";

type Bucket = "register" | "login" | "catalogSearch";

const T0 = new Date("2026-01-10T10:00:00.000Z");
const HOUR = 3_600_000;
const MINUTE = 60_000;
const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs);

function hit(bucket: Bucket, key: string, count: number, now: Date) {
  for (let i = 0; i < count; i += 1) {
    enforceRateLimit(bucket, key, now);
  }
}

/** El error que lanza la petición, o `undefined` si pasó. */
function outcome(bucket: Bucket, key: string, now: Date) {
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

describe("F10 / F17 · límites de los cubos register y login (ADR-0008)", () => {
  it("el registro admite 10 por hora", () => {
    expect(RATE_LIMITS.register).toEqual({ limit: 10, windowMs: 3_600_000 });
  });

  it("el ingreso admite 30 por minuto", () => {
    expect(RATE_LIMITS.login).toEqual({ limit: 30, windowMs: 60_000 });
  });

  it("los cubos anteriores no cambian", () => {
    expect(RATE_LIMITS.catalogSearch).toEqual({ limit: 60, windowMs: 60_000 });
    expect(RATE_LIMITS.memberSearch).toEqual({ limit: 30, windowMs: 60_000 });
  });
});

describe("F10 · cubo register", () => {
  it("el registro número 10 pasa y el 11 recibe 429", () => {
    hit("register", "1.2.3.4", 10, T0);

    expect(outcome("register", "1.2.3.4", T0)).toBeInstanceOf(TooManyRequestsError);
  });

  it("el primer registro pasa (borde: 1 de 10)", () => {
    expect(outcome("register", "1.2.3.4", T0)).toBeUndefined();
  });

  it("el 429 indica los segundos que faltan para la hora completa", () => {
    hit("register", "ip", 10, T0);

    expect(outcome("register", "ip", T0)?.retryAfterSeconds).toBe(3600);
    expect(outcome("register", "ip", at(10 * MINUTE))?.retryAfterSeconds).toBe(3000);
  });

  it("a los 59 min 59,999 s sigue rechazando y en la hora exacta abre ventana nueva", () => {
    hit("register", "ip", 10, T0);

    expect(outcome("register", "ip", at(HOUR - 1))).toBeInstanceOf(TooManyRequestsError);
    expect(outcome("register", "ip", at(HOUR))).toBeUndefined();
  });

  it("a los 61 segundos el cupo de registro sigue agotado", () => {
    hit("register", "ip", 10, T0);

    expect(outcome("register", "ip", at(61_000))).toBeInstanceOf(TooManyRequestsError);
  });

  it("otra IP no se ve afectada", () => {
    hit("register", "1.1.1.1", 10, T0);

    expect(outcome("register", "1.1.1.1", T0)).toBeInstanceOf(TooManyRequestsError);
    expect(outcome("register", "2.2.2.2", T0)).toBeUndefined();
  });

  it("sin IP válida («desconocida») no se limita nunca", () => {
    const unknown = clientKey(new Request("http://localhost/api/auth/register"));

    for (let i = 0; i < 100; i += 1) {
      expect(outcome("register", unknown, T0)).toBeUndefined();
    }
  });
});

describe("F17 · cubo login", () => {
  it("el ingreso número 30 pasa y el 31 recibe 429", () => {
    hit("login", "1.2.3.4", 30, T0);

    expect(outcome("login", "1.2.3.4", T0)).toBeInstanceOf(TooManyRequestsError);
  });

  it("el 29.º y el 30.º pasan (borde del límite)", () => {
    hit("login", "ip", 29, T0);

    expect(outcome("login", "ip", T0)).toBeUndefined();
    expect(outcome("login", "ip", T0)).toBeInstanceOf(TooManyRequestsError);
  });

  it("a los 60 s abre una ventana nueva; a los 59,999 s todavía rechaza", () => {
    hit("login", "ip", 30, T0);

    expect(outcome("login", "ip", at(MINUTE - 1))).toBeInstanceOf(TooManyRequestsError);
    expect(outcome("login", "ip", at(MINUTE))).toBeUndefined();
  });

  it("sin IP válida («desconocida») no se limita nunca", () => {
    for (let i = 0; i < 100; i += 1) {
      expect(outcome("login", "desconocida", T0)).toBeUndefined();
    }
  });
});

describe("F10 / F17 · los cubos son independientes entre sí", () => {
  it("agotar register no afecta a login con la misma IP, y al revés", () => {
    hit("register", "ip", 10, T0);
    hit("login", "otra", 30, T0);

    expect(outcome("register", "ip", T0)).toBeInstanceOf(TooManyRequestsError);
    expect(outcome("login", "ip", T0)).toBeUndefined();
    expect(outcome("login", "otra", T0)).toBeInstanceOf(TooManyRequestsError);
    expect(outcome("register", "otra", T0)).toBeUndefined();
  });
});

describe("Barrido de claves vencidas con ventanas de 1 minuto y de 1 hora (spec F10, interfaz de módulos)", () => {
  /** Llena el mapa con `count` claves de login distintas en el instante `now`. */
  function fillLogin(prefix: string, count: number, now: Date) {
    for (let i = 0; i < count; i += 1) {
      enforceRateLimit("login", `${prefix}-${i}`, now);
    }
  }

  /**
   * Cada minuto el mapa se llena (la clave de register + 9 999 claves de login nuevas = tope de 10 000); las
   * claves de login de la ronda anterior ya vencieron y la inserción siguiente fuerza un barrido por minuto.
   */
  function sweepEveryMinute(rounds: number) {
    for (let minute = 1; minute <= rounds; minute += 1) {
      fillLogin(`ronda-${minute}`, 9_999, at(minute * MINUTE + 1_000));
    }
  }

  it("una clave de register agotada no se descarta antes de su hora aunque el barrido de login corra cada minuto", () => {
    hit("register", "agotada", 10, T0);

    sweepEveryMinute(5);

    expect(outcome("register", "agotada", at(6 * MINUTE))).toBeInstanceOf(TooManyRequestsError);
  });

  it("tras 59 minutos de barridos, la clave de register sigue agotada y a la hora exacta se libera", () => {
    hit("register", "agotada", 10, T0);

    sweepEveryMinute(58);

    expect(outcome("register", "agotada", at(58 * MINUTE + 3_000))).toBeInstanceOf(TooManyRequestsError);
    expect(outcome("register", "agotada", at(HOUR))).toBeUndefined();
  });

  it("con el mapa lleno de claves de login vencidas, un registro nuevo se limita bien y no se pierde", () => {
    fillLogin("vieja", 10_000, T0);

    hit("register", "nueva", 10, at(2 * MINUTE));

    expect(outcome("register", "nueva", at(2 * MINUTE))).toBeInstanceOf(TooManyRequestsError);
    expect(outcome("register", "nueva", at(30 * MINUTE))).toBeInstanceOf(TooManyRequestsError);
  });

  it("las claves de login vencidas sí se barren: una IP que agotó el ingreso vuelve a pasar tras el minuto", () => {
    hit("login", "caliente", 30, T0);
    fillLogin("relleno", 10_000, T0);
    enforceRateLimit("login", "disparador", at(2 * MINUTE));

    expect(outcome("login", "caliente", at(2 * MINUTE))).toBeUndefined();
  });

  it("una clave de register con la ventana abierta sobrevive a un barrido aunque sea la más antigua del mapa", () => {
    hit("register", "primera", 10, T0);
    fillLogin("relleno", 9_999, at(1_000));

    expect(outcome("login", "nueva", at(2 * MINUTE))).toBeUndefined();
    expect(outcome("register", "primera", at(2 * MINUTE))).toBeInstanceOf(TooManyRequestsError);
  });

  it("una clave de register vencida (pasada la hora) sí se barre con el mapa lleno y vuelve a empezar", () => {
    hit("register", "vieja", 10, T0);
    fillLogin("relleno", 9_999, at(HOUR - 1_000));

    expect(outcome("login", "nueva", at(HOUR + 1_000))).toBeUndefined();
    expect(outcome("register", "vieja", at(HOUR + 1_000))).toBeUndefined();
  });
});
