import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiErrorSchema, type Role } from "@/shared/schema";
import { resetRateLimits } from "@/shared/server/security/rate-limit";
import { DAY_MS, makeTeacherWorld, NOTE, type Person, T0, type TeacherWorld } from "@/tests/helpers/teacher-requests";
import { TeacherRequestPageSchema, TeacherRequestSchema } from "../schema";
import { GET as listRoute } from "@/api/teacher-requests/route";
import { POST as approveRoute } from "@/api/teacher-requests/[id]/approve/route";
import { POST as rejectRoute } from "@/api/teacher-requests/[id]/reject/route";

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

const JSON_HEADERS = { "content-type": "application/json", origin: "http://localhost" };
const SAME_ORIGIN = { origin: "http://localhost" };

function currentWorld(): TeacherWorld {
  if (holder.world === null) {
    throw new Error("sin mundo");
  }
  return holder.world;
}

async function signIn(role: Role): Promise<Person> {
  const person = await currentWorld().addPerson(role);
  holder.uid = person.id;
  return person;
}

function list(search = "") {
  return listRoute(new NextRequest(`http://localhost/api/teacher-requests${search}`));
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

function approve(id: string, headers: Record<string, string> = SAME_ORIGIN) {
  const url = `http://localhost/api/teacher-requests/${encodeURIComponent(id)}/approve`;
  return approveRoute(new NextRequest(url, { method: "POST", headers }), context(id));
}

function rejectRaw(id: string, rawBody: string | null, headers: Record<string, string> = JSON_HEADERS) {
  const url = `http://localhost/api/teacher-requests/${encodeURIComponent(id)}/reject`;
  const init: { method: string; headers: Record<string, string>; body?: string } = { method: "POST", headers };
  if (rawBody !== null) {
    init.body = rawBody;
  }
  return rejectRoute(new NextRequest(url, init), context(id));
}

function reject(id: string, payload: Json) {
  return rejectRaw(id, JSON.stringify(payload));
}

/** Una persona con solicitud pendiente, enviada `minutes` minutos después de `T0`. */
async function pendingPerson(minutes = 0, role: "EXTERNO" | "ESTUDIANTE" = "ESTUDIANTE"): Promise<Person> {
  const person = await currentWorld().addPerson(role);
  await currentWorld().ask(person, new Date(T0.getTime() + minutes * 60_000));
  return person;
}

async function errorOf(response: Response): Promise<string> {
  return ApiErrorSchema.parse(await response.json()).error;
}

async function statusOf(person: Person): Promise<string | undefined> {
  return (await currentWorld().requests.get(person.id))?.status;
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

describe("F12 · GET /api/teacher-requests · autorización (regla 12)", () => {
  it("sin sesión: 401", async () => {
    const response = await list();

    expect(response.status).toBe(401);
    expect(ApiErrorSchema.safeParse(await response.json()).success).toBe(true);
  });

  it.each([
    "EXTERNO",
    "ESTUDIANTE",
    "DOCENTE",
  ] satisfies Role[])("un %s recibe 403 y no ve ninguna solicitud", async (role) => {
    await pendingPerson();
    await signIn(role);

    const response = await list();

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(NOTE);
  });

  it("el dueño de una solicitud tampoco puede listarla: 403", async () => {
    const owner = await pendingPerson();
    holder.uid = owner.id;

    expect((await list()).status).toBe(403);
  });

  it.each(["BIBLIOTECARIO", "ADMINISTRADOR"] satisfies Role[])("el %s puede listar: 200", async (role) => {
    await signIn(role);

    expect((await list()).status).toBe(200);
  });

  it("un prestatario con un limit inválido recibe 403: la autorización va primero", async () => {
    await signIn("ESTUDIANTE");

    expect((await list("?limit=0")).status).toBe(403);
  });

  it("una cuenta de personal desactivada recibe 401", async () => {
    const staff = await signIn("BIBLIOTECARIO");
    currentWorld().deactivate(staff);

    expect((await list()).status).toBe(401);
  });
});

describe("F12 · GET /api/teacher-requests · contenido (criterio de aceptación)", () => {
  beforeEach(async () => {
    await signIn("BIBLIOTECARIO");
  });

  it("sin solicitudes: página vacía con next_after null", async () => {
    expect(await (await list()).json()).toEqual({ requests: [], next_after: null });
  });

  it("las pendientes de la más antigua a la más reciente, con nombre, correo y email_verified", async () => {
    const late = await currentWorld().addPerson("EXTERNO", { name: "Carlos Tarde" });
    const early = await currentWorld().addPerson("ESTUDIANTE", { name: "Ana Temprano" });
    await currentWorld().ask(late, new Date(T0.getTime() + DAY_MS));
    await currentWorld().ask(early, T0);
    currentWorld().identity.markEmailUnverified(late.id);

    const response = await list();
    const page = TeacherRequestPageSchema.strict().parse(await response.json());

    expect(response.status).toBe(200);
    expect(page.requests.map((item) => item.member_name)).toEqual(["Ana Temprano", "Carlos Tarde"]);
    expect(page.requests[0]).toMatchObject({
      member_id: early.id,
      member_email: early.email,
      member_role: "ESTUDIANTE",
      email_verified: true,
      status: "PENDIENTE",
      note: NOTE,
    });
    expect(page.requests[1]).toMatchObject({ member_email: late.email, member_role: "EXTERNO", email_verified: false });
  });

  it("no incluye contraseñas ni campos internos de la cuenta", async () => {
    await pendingPerson();

    const text = await (await list()).text();

    expect(text).not.toContain("password");
    expect(text).not.toContain("search_keys");
    expect(text).not.toContain("clave-segura-123");
  });

  it("por defecto solo lista las PENDIENTES; status filtra por estado", async () => {
    const pending = await pendingPerson(0);
    const approved = await pendingPerson(1);
    const rejected = await pendingPerson(2);
    const actor = { member_id: holder.uid ?? "", role: "BIBLIOTECARIO" } as const;
    await currentWorld().service.approve(actor, approved.id, T0);
    await currentWorld().service.reject(actor, rejected.id, {}, T0);

    const ids = async (search: string) =>
      TeacherRequestPageSchema.parse(await (await list(search)).json()).requests.map((item) => item.member_id);

    expect(await ids("")).toEqual([pending.id]);
    expect(await ids("?status=PENDIENTE")).toEqual([pending.id]);
    expect(await ids("?status=APROBADA")).toEqual([approved.id]);
    expect(await ids("?status=RECHAZADA")).toEqual([rejected.id]);
  });

  it("una solicitud cuya cuenta fue borrada se omite sin fallar", async () => {
    const present = await pendingPerson(1);
    await currentWorld().requests.create(
      {
        member_id: "cuenta-borrada",
        note: NOTE,
        status: "PENDIENTE",
        requested_at: T0.toISOString(),
        decided_at: null,
        decided_by: null,
        reason: null,
      },
      new Date(T0.getTime() - 8 * DAY_MS),
    );

    const response = await list();

    expect(response.status).toBe(200);
    expect(TeacherRequestPageSchema.parse(await response.json()).requests.map((item) => item.member_id)).toEqual([
      present.id,
    ]);
  });

  it("el listado no gasta el límite de tasa de las solicitudes", async () => {
    for (let i = 0; i < 12; i += 1) {
      expect((await list()).status).toBe(200);
    }
  });
});

describe("F12 · GET /api/teacher-requests · validación y páginas", () => {
  beforeEach(async () => {
    await signIn("BIBLIOTECARIO");
  });

  it.each(["pendiente", "PENDING", "", "TODAS", "APROBADA,RECHAZADA"])("status=%s: 400", async (status) => {
    const response = await list(`?status=${encodeURIComponent(status)}`);

    expect(response.status).toBe(400);
    expect(ApiErrorSchema.safeParse(await response.json()).success).toBe(true);
  });

  it.each(["0", "101", "-1", "abc", "2.5"])("limit=%s: 400", async (limit) => {
    expect((await list(`?limit=${limit}`)).status).toBe(400);
  });

  it("limit 1 y limit 100 se aceptan", async () => {
    expect((await list("?limit=1")).status).toBe(200);
    expect((await list("?limit=100")).status).toBe(200);
  });

  it("un after que no corresponde a ninguna solicitud: 400", async () => {
    await pendingPerson();

    const response = await list("?after=desconocido");

    expect(response.status).toBe(400);
    expect(ApiErrorSchema.safeParse(await response.json()).success).toBe(true);
  });

  it("un after mal formado (con «/»): 400", async () => {
    expect((await list(`?after=${encodeURIComponent("a/b")}`)).status).toBe(400);
  });

  it("1 solicitud: una y sin cursor", async () => {
    await pendingPerson();

    const page = TeacherRequestPageSchema.parse(await (await list()).json());

    expect(page.requests).toHaveLength(1);
    expect(page.next_after).toBeNull();
  });

  it("50 solicitudes caben en una página sin cursor; 51 dejan un cursor y una más en la segunda", async () => {
    for (let i = 0; i < 50; i += 1) {
      await pendingPerson(i, "EXTERNO");
    }
    const exact = TeacherRequestPageSchema.parse(await (await list()).json());
    expect(exact.requests).toHaveLength(50);
    expect(exact.next_after).toBeNull();

    const last = await pendingPerson(50, "EXTERNO");
    const first = TeacherRequestPageSchema.parse(await (await list()).json());
    const second = TeacherRequestPageSchema.parse(await (await list(`?after=${first.next_after}`)).json());

    expect(first.requests).toHaveLength(50);
    expect(first.next_after).toBe(first.requests[49]?.member_id);
    expect(second.requests.map((item) => item.member_id)).toEqual([last.id]);
    expect(second.next_after).toBeNull();
  });

  it("seguir next_after con limit 2 recorre las 5 solicitudes sin repetir ninguna", async () => {
    for (let i = 0; i < 5; i += 1) {
      await pendingPerson(i, "EXTERNO");
    }

    const sizes: number[] = [];
    const seen: string[] = [];
    let search = "?limit=2";
    for (let guard = 0; guard < 6; guard += 1) {
      const page = TeacherRequestPageSchema.parse(await (await list(search)).json());
      sizes.push(page.requests.length);
      seen.push(...page.requests.map((item) => item.member_id));
      if (page.next_after === null) {
        break;
      }
      search = `?limit=2&after=${page.next_after}`;
    }

    expect(sizes).toEqual([2, 2, 1]);
    expect(new Set(seen).size).toBe(5);
  });
});

describe("F12 · POST approve · autorización y protección (regla 15)", () => {
  it("un POST de otro origen: 403 aunque no haya sesión y no se aprueba nada", async () => {
    const person = await pendingPerson();

    const response = await approve(person.id, { origin: "https://evil.example" });

    expect(response.status).toBe(403);
    expect(await statusOf(person)).toBe("PENDIENTE");
  });

  it("un POST de otro origen con sesión de personal: 403 y no se aprueba nada", async () => {
    const person = await pendingPerson();
    await signIn("ADMINISTRADOR");

    expect((await approve(person.id, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect(await statusOf(person)).toBe("PENDIENTE");
    expect(await currentWorld().roleOf(person)).toBe("ESTUDIANTE");
  });

  it("sin sesión: 401", async () => {
    const person = await pendingPerson();

    expect((await approve(person.id)).status).toBe(401);
    expect(await statusOf(person)).toBe("PENDIENTE");
  });

  it.each([
    "EXTERNO",
    "ESTUDIANTE",
    "DOCENTE",
  ] satisfies Role[])("un %s recibe 403 y no se aprueba nada", async (role) => {
    const person = await pendingPerson();
    await signIn(role);

    expect((await approve(person.id)).status).toBe(403);
    expect(await statusOf(person)).toBe("PENDIENTE");
    expect(await currentWorld().roleOf(person)).toBe("ESTUDIANTE");
  });

  it("el dueño no puede aprobar su propia solicitud: 403", async () => {
    const owner = await pendingPerson();
    holder.uid = owner.id;

    expect((await approve(owner.id)).status).toBe(403);
    expect(await currentWorld().roleOf(owner)).toBe("ESTUDIANTE");
  });

  it("la autorización va antes que la validación del id: un prestatario con id mal formado recibe 403", async () => {
    await signIn("ESTUDIANTE");

    expect((await approve("a/b")).status).toBe(403);
  });

  it("sin sesión y con id mal formado: 401", async () => {
    expect((await approve("a/b")).status).toBe(401);
  });

  it("una cuenta de personal desactivada recibe 401", async () => {
    const person = await pendingPerson();
    const staff = await signIn("BIBLIOTECARIO");
    currentWorld().deactivate(staff);

    expect((await approve(person.id)).status).toBe(401);
    expect(await statusOf(person)).toBe("PENDIENTE");
  });
});

describe("F12 · POST approve · aprobar (200)", () => {
  it.each([
    "BIBLIOTECARIO",
    "ADMINISTRADOR",
  ] satisfies Role[])("el %s aprueba: 200, DOCENTE y APROBADA con su id", async (role) => {
    const person = await pendingPerson();
    const staff = await signIn(role);

    const response = await approve(person.id);

    expect(response.status).toBe(200);
    expect(TeacherRequestSchema.strict().parse(await response.json())).toEqual({
      member_id: person.id,
      note: NOTE,
      status: "APROBADA",
      requested_at: T0.toISOString(),
      decided_at: T0.toISOString(),
      decided_by: staff.id,
      reason: null,
    });
    expect(await currentWorld().roleOf(person)).toBe("DOCENTE");
  });

  it("aprobar funciona sin cuerpo y sin Content-Type (con el mismo origen)", async () => {
    const person = await pendingPerson();
    await signIn("BIBLIOTECARIO");

    expect((await approve(person.id, { "sec-fetch-site": "same-origin" })).status).toBe(200);
  });

  it("la fecha de la decisión es la del momento de la petición", async () => {
    const person = await pendingPerson();
    await signIn("BIBLIOTECARIO");
    const later = new Date("2026-02-01T09:00:00.000Z");
    vi.setSystemTime(later);

    expect(TeacherRequestSchema.parse(await (await approve(person.id)).json()).decided_at).toBe(later.toISOString());
  });

  it("una solicitud inexistente: 404", async () => {
    await signIn("BIBLIOTECARIO");

    const response = await approve("no-existe");

    expect(response.status).toBe(404);
    expect(ApiErrorSchema.safeParse(await response.json()).success).toBe(true);
  });

  it.each(["a/b", "..", "__reservado__"])("un id mal formado «%s»: 400", async (id) => {
    await signIn("BIBLIOTECARIO");

    expect((await approve(id)).status).toBe(400);
  });

  it("aprobar dos veces: 409 «La solicitud ya fue resuelta.»", async () => {
    const person = await pendingPerson();
    await signIn("BIBLIOTECARIO");
    expect((await approve(person.id)).status).toBe(200);

    const response = await approve(person.id);

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe("La solicitud ya fue resuelta.");
  });

  it("aprobar una ya rechazada: 409 y sigue rechazada", async () => {
    const person = await pendingPerson();
    await signIn("BIBLIOTECARIO");
    expect((await reject(person.id, {})).status).toBe(200);

    const response = await approve(person.id);

    expect(response.status).toBe(409);
    expect(await statusOf(person)).toBe("RECHAZADA");
    expect(await currentWorld().roleOf(person)).toBe("ESTUDIANTE");
  });

  it("dos aprobaciones simultáneas: exactamente una responde 200 y la otra 409", async () => {
    const person = await pendingPerson();
    await signIn("BIBLIOTECARIO");

    const responses = await Promise.all([approve(person.id), approve(person.id)]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await currentWorld().roleOf(person)).toBe("DOCENTE");
  });

  it("aprobar y rechazar a la vez: gana uno y el otro recibe 409", async () => {
    const person = await pendingPerson();
    await signIn("BIBLIOTECARIO");

    const responses = await Promise.all([approve(person.id), reject(person.id, {})]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  });
});

describe("F12 · POST approve · la cuenta cambió (409 y sigue PENDIENTE)", () => {
  beforeEach(async () => {
    await signIn("BIBLIOTECARIO");
  });

  it("cuenta desactivada", async () => {
    const person = await pendingPerson();
    currentWorld().deactivate(person);

    const response = await approve(person.id);

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe("La cuenta ya no puede recibir el rol de docente.");
    expect(await statusOf(person)).toBe("PENDIENTE");
  });

  it("la cuenta ya es DOCENTE", async () => {
    const person = await pendingPerson();
    await currentWorld().repos.members.setRole(person.id, "DOCENTE");

    const response = await approve(person.id);

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe("La cuenta ya no puede recibir el rol de docente.");
    expect(await statusOf(person)).toBe("PENDIENTE");
  });

  it("el correo dejó de estar verificado", async () => {
    const person = await pendingPerson();
    currentWorld().identity.markEmailUnverified(person.id);

    const response = await approve(person.id);

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe("El correo de la persona ya no está verificado.");
    expect(await statusOf(person)).toBe("PENDIENTE");
    expect(await currentWorld().roleOf(person)).toBe("ESTUDIANTE");
  });
});

describe("F12 · POST reject · autorización y protección (regla 15)", () => {
  it("un POST de otro origen: 403 y no se rechaza nada", async () => {
    const person = await pendingPerson();
    await signIn("BIBLIOTECARIO");

    const response = await rejectRaw(person.id, "{}", { ...JSON_HEADERS, origin: "https://evil.example" });

    expect(response.status).toBe(403);
    expect(await statusOf(person)).toBe("PENDIENTE");
  });

  it("un cuerpo que no declara application/json: 403", async () => {
    const person = await pendingPerson();
    await signIn("BIBLIOTECARIO");

    const response = await rejectRaw(person.id, "reason=no", {
      origin: "http://localhost",
      "content-type": "application/x-www-form-urlencoded",
    });

    expect(response.status).toBe(403);
    expect(await statusOf(person)).toBe("PENDIENTE");
  });

  it("sin sesión: 401", async () => {
    const person = await pendingPerson();

    expect((await reject(person.id, {})).status).toBe(401);
  });

  it.each(["EXTERNO", "ESTUDIANTE", "DOCENTE"] satisfies Role[])("un %s recibe 403", async (role) => {
    const person = await pendingPerson();
    await signIn(role);

    expect((await reject(person.id, {})).status).toBe(403);
    expect(await statusOf(person)).toBe("PENDIENTE");
  });

  it("el dueño de la solicitud recibe 403", async () => {
    const owner = await pendingPerson();
    holder.uid = owner.id;

    expect((await reject(owner.id, {})).status).toBe(403);
  });

  it("la autorización va antes que la validación del id y del cuerpo", async () => {
    await signIn("ESTUDIANTE");

    expect((await reject("a/b", { reason: "x".repeat(400) })).status).toBe(403);
  });
});

describe("F12 · POST reject · rechazar (200)", () => {
  beforeEach(async () => {
    await signIn("BIBLIOTECARIO");
  });

  it.each([
    "BIBLIOTECARIO",
    "ADMINISTRADOR",
  ] satisfies Role[])("el %s rechaza con motivo: 200, RECHAZADA, con su id y el rol sin cambios", async (role) => {
    const person = await pendingPerson();
    const staff = await signIn(role);

    const response = await reject(person.id, { reason: "No pudimos comprobar tu cargo" });

    expect(response.status).toBe(200);
    expect(TeacherRequestSchema.strict().parse(await response.json())).toEqual({
      member_id: person.id,
      note: NOTE,
      status: "RECHAZADA",
      requested_at: T0.toISOString(),
      decided_at: T0.toISOString(),
      decided_by: staff.id,
      reason: "No pudimos comprobar tu cargo",
    });
    expect(await currentWorld().roleOf(person)).toBe("ESTUDIANTE");
  });

  it("sin cuerpo (sin Content-Type): 200 y motivo null", async () => {
    const person = await pendingPerson();

    const response = await rejectRaw(person.id, null, { origin: "http://localhost" });

    expect(response.status).toBe(200);
    expect(TeacherRequestSchema.parse(await response.json()).reason).toBeNull();
  });

  it.each([
    ["un objeto vacío", "{}"],
    ["un motivo vacío", '{"reason":""}'],
    ["un motivo de solo espacios", '{"reason":"    "}'],
  ])("%s: 200 y motivo null", async (_name, raw) => {
    const person = await pendingPerson();

    const response = await rejectRaw(person.id, raw);

    expect(response.status).toBe(200);
    expect(TeacherRequestSchema.parse(await response.json()).reason).toBeNull();
  });

  it("el motivo se guarda recortado", async () => {
    const person = await pendingPerson();

    const rejected = TeacherRequestSchema.parse(await (await reject(person.id, { reason: "  Sin pruebas  " })).json());

    expect(rejected.reason).toBe("Sin pruebas");
  });

  it.each([
    [300, 200],
    [301, 400],
  ])("motivo de %i caracteres: %i", async (length, status) => {
    const person = await pendingPerson();

    const response = await reject(person.id, { reason: "m".repeat(length) });

    expect(response.status).toBe(status);
    const expected: Record<number, string> = { 200: "RECHAZADA", 400: "PENDIENTE" };
    expect(await statusOf(person)).toBe(expected[status]);
  });

  it.each([
    ["un motivo numérico", { reason: 5 }],
    ["un motivo nulo", { reason: null }],
    ["un motivo como arreglo", { reason: ["x"] }],
    ["un cuerpo que es un arreglo", []],
    ["un cuerpo que es texto", "hola"],
  ] satisfies [string, Json][])("%s: 400 y la solicitud sigue PENDIENTE", async (_name, body) => {
    const person = await pendingPerson();

    expect((await reject(person.id, body)).status).toBe(400);
    expect(await statusOf(person)).toBe("PENDIENTE");
  });

  it("un cuerpo que no es JSON: 400", async () => {
    const person = await pendingPerson();

    expect((await rejectRaw(person.id, "esto no es json")).status).toBe(400);
    expect(await statusOf(person)).toBe("PENDIENTE");
  });

  it("los campos extra del cuerpo se ignoran: status APROBADA no aprueba", async () => {
    const person = await pendingPerson();

    const response = await reject(person.id, { reason: "No", status: "APROBADA", decided_by: "otro" });

    expect(TeacherRequestSchema.parse(await response.json())).toMatchObject({ status: "RECHAZADA", reason: "No" });
    expect(await currentWorld().roleOf(person)).toBe("ESTUDIANTE");
  });

  it("rechazar no exige que la cuenta siga activa ni verificada", async () => {
    const person = await pendingPerson();
    currentWorld().deactivate(person);
    currentWorld().identity.markEmailUnverified(person.id);

    expect((await reject(person.id, {})).status).toBe(200);
  });

  it("una solicitud inexistente: 404", async () => {
    expect((await reject("no-existe", {})).status).toBe(404);
  });

  it.each(["a/b", "..", "__reservado__"])("un id mal formado «%s»: 400", async (id) => {
    expect((await reject(id, {})).status).toBe(400);
  });

  it("rechazar dos veces: 409 «La solicitud ya fue resuelta.» y se conserva el primer motivo", async () => {
    const person = await pendingPerson();
    expect((await reject(person.id, { reason: "Primero" })).status).toBe(200);

    const response = await reject(person.id, { reason: "Segundo" });

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe("La solicitud ya fue resuelta.");
    expect((await currentWorld().requests.get(person.id))?.reason).toBe("Primero");
  });

  it("rechazar una ya aprobada: 409 y la persona sigue siendo DOCENTE", async () => {
    const person = await pendingPerson();
    expect((await approve(person.id)).status).toBe(200);

    expect((await reject(person.id, {})).status).toBe(409);
    expect(await statusOf(person)).toBe("APROBADA");
    expect(await currentWorld().roleOf(person)).toBe("DOCENTE");
  });

  it("el motivo se ve después en el listado de RECHAZADA", async () => {
    const person = await pendingPerson();
    await reject(person.id, { reason: "Falta soporte" });

    const page = TeacherRequestPageSchema.parse(await (await list("?status=RECHAZADA")).json());

    expect(page.requests[0]).toMatchObject({ member_id: person.id, reason: "Falta soporte" });
  });
});
