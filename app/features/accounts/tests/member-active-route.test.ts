import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiErrorSchema, type Role } from "@/shared/schema";
import { resetRateLimits } from "@/shared/server/security/rate-limit";
import { makeStaffWorld, type StaffPerson, type StaffWorld } from "@/tests/helpers/staff";
import { MemberPageSchema, MemberSchema } from "../schema";
import { PATCH as activeRoute } from "@/api/members/[id]/active/route";
import { GET as membersRoute } from "@/api/members/route";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const holder = vi.hoisted(() => ({
  world: null as StaffWorld | null,
  cookie: undefined as string | undefined,
}));

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => {
      if (holder.cookie === undefined) {
        return undefined;
      }
      return { value: holder.cookie };
    },
  }),
}));

// La sesión real: la cookie la emite la identidad en memoria y el rol y el estado se leen de la cuenta guardada.
vi.mock("@/shared/server/firebase", () => ({
  getAdminAuth: () => ({
    verifySessionCookie: async (cookie: string) => {
      const verified = await holder.world?.identity.verifySessionCookie(cookie);
      if (!verified) {
        throw Object.assign(new Error("sin sesión"), { code: "auth/invalid-session-cookie" });
      }
      return verified;
    },
  }),
  getAdminDb: () => ({
    collection: () => ({
      doc: (uid: string) => ({
        get: async () => {
          const row = await holder.world?.repos.members.findById(uid);
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
    const { create, list, setActive } = holder.world.staff;
    return { staff: { create, list, setActive }, members: holder.world.members };
  },
}));

const T0 = new Date("2026-01-10T10:00:00.000Z");
const JSON_HEADERS = { "content-type": "application/json", origin: "http://localhost" };
const STAFF_ONLY = "Solo para personal de la biblioteca";
const BORROWERS = ["EXTERNO", "ESTUDIANTE", "DOCENTE"] satisfies Role[];

function currentWorld(): StaffWorld {
  if (holder.world === null) {
    throw new Error("sin mundo");
  }
  return holder.world;
}

async function signInAs(role: Role): Promise<StaffPerson> {
  const person = await currentWorld().addPerson(role);
  holder.cookie = await currentWorld().sessionCookieFor(person);
  return person;
}

async function signInPerson(person: StaffPerson): Promise<void> {
  holder.cookie = await currentWorld().sessionCookieFor(person);
}

function patchRaw(id: string, rawBody: string | null, headers: Record<string, string> = JSON_HEADERS) {
  const init: { method: string; headers: Record<string, string>; body?: string } = { method: "PATCH", headers };
  if (rawBody !== null) {
    init.body = rawBody;
  }
  const url = `http://localhost/api/members/${encodeURIComponent(id)}/active`;
  return activeRoute(new NextRequest(url, init), { params: Promise.resolve({ id }) });
}

function patch(id: string, payload: Json) {
  return patchRaw(id, JSON.stringify(payload));
}

async function errorOf(response: Response): Promise<string> {
  return ApiErrorSchema.parse(await response.json()).error;
}

async function isActive(person: { id: string }): Promise<boolean | undefined> {
  return (await currentWorld().stored(person))?.active;
}

beforeEach(() => {
  resetRateLimits();
  holder.world = makeStaffWorld();
  holder.cookie = undefined;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("F14 · PATCH /api/members/:id/active · sesión y origen (reglas 6 y 8)", () => {
  it("sin sesión: 401 y nada cambia", async () => {
    const student = await currentWorld().addPerson("ESTUDIANTE");

    const response = await patch(student.id, { active: false });

    expect(response.status).toBe(401);
    expect(ApiErrorSchema.safeParse(await response.json()).success).toBe(true);
    expect(await isActive(student)).toBe(true);
  });

  it("sin sesión y con :id y cuerpo inválidos: 401", async () => {
    expect((await patchRaw("a/b", "esto no es json")).status).toBe(401);
  });

  it("una cookie que no emitió nuestra identidad: 401", async () => {
    holder.cookie = "cookie-falsa";
    const student = await currentWorld().addPerson("ESTUDIANTE");

    expect((await patch(student.id, { active: false })).status).toBe(401);
  });

  it("otro origen: 403 aunque el personal tenga sesión, y nada cambia", async () => {
    const student = await currentWorld().addPerson("ESTUDIANTE");
    await signInAs("BIBLIOTECARIO");

    const response = await patchRaw(student.id, '{"active":false}', {
      ...JSON_HEADERS,
      origin: "https://evil.example",
    });

    expect(response.status).toBe(403);
    expect(await isActive(student)).toBe(true);
  });

  it("Sec-Fetch-Site cross-site: 403", async () => {
    const student = await currentWorld().addPerson("ESTUDIANTE");
    await signInAs("ADMINISTRADOR");

    const response = await patchRaw(student.id, '{"active":false}', {
      "content-type": "application/json",
      "sec-fetch-site": "cross-site",
    });

    expect(response.status).toBe(403);
    expect(await isActive(student)).toBe(true);
  });

  it("un cuerpo que no declara application/json: 403", async () => {
    const student = await currentWorld().addPerson("ESTUDIANTE");
    await signInAs("ADMINISTRADOR");

    const response = await patchRaw(student.id, "active=false", {
      origin: "http://localhost",
      "content-type": "application/x-www-form-urlencoded",
    });

    expect(response.status).toBe(403);
    expect(await isActive(student)).toBe(true);
  });

  it("el origen se comprueba antes que la sesión: otro origen sin sesión da 403, no 401", async () => {
    const response = await patchRaw("x", '{"active":false}', { ...JSON_HEADERS, origin: "https://evil.example" });

    expect(response.status).toBe(403);
  });

  it("una cuenta de personal desactivada ya no tiene sesión: 401", async () => {
    const librarian = await signInAs("BIBLIOTECARIO");
    const student = await currentWorld().addPerson("ESTUDIANTE");
    await currentWorld().repos.members.setActive(librarian.id, false);

    expect((await patch(student.id, { active: false })).status).toBe(401);
    expect(await isActive(student)).toBe(true);
  });
});

describe("F14 · PATCH · los prestatarios no son personal (regla 8)", () => {
  it.each(BORROWERS)("un %s recibe 403 «Solo para personal de la biblioteca»", async (role) => {
    const student = await currentWorld().addPerson("ESTUDIANTE");
    await signInAs(role);

    const response = await patch(student.id, { active: false });

    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe(STAFF_ONLY);
    expect(await isActive(student)).toBe(true);
  });

  it.each(BORROWERS)("un %s no puede cambiar ni su propio estado", async (role) => {
    const borrower = await signInAs(role);

    expect((await patch(borrower.id, { active: false })).status).toBe(403);
    expect(await isActive(borrower)).toBe(true);
  });

  it.each(BORROWERS)("un %s recibe 403 aunque el :id sea inválido", async (role) => {
    await signInAs(role);

    expect((await patch("a/b", { active: false })).status).toBe(403);
    expect((await patch("x".repeat(129), { active: false })).status).toBe(403);
    expect((await patch("__x__", { active: false })).status).toBe(403);
  });

  it.each(BORROWERS)("un %s recibe 403 aunque el cuerpo sea basura", async (role) => {
    await signInAs(role);

    expect((await patchRaw("alguien", "esto no es json")).status).toBe(403);
    expect((await patchRaw("alguien", "")).status).toBe(403);
    expect((await patch("alguien", { active: "true" })).status).toBe(403);
    expect((await patch("alguien", { active: null })).status).toBe(403);
    expect((await patch("alguien", {})).status).toBe(403);
  });

  it.each(BORROWERS)("un %s recibe 403 aunque la cuenta destino no exista", async (role) => {
    await signInAs(role);

    expect((await patch("no-existe", { active: false })).status).toBe(403);
  });
});

describe("F14 · PATCH · matriz de la regla 7 por HTTP: bibliotecario", () => {
  let librarian: StaffPerson;

  beforeEach(async () => {
    librarian = await signInAs("BIBLIOTECARIO");
  });

  it.each(BORROWERS)("desactiva y reactiva a un %s: 200 con la cuenta actualizada", async (role) => {
    const target = await currentWorld().addPerson(role);

    const off = await patch(target.id, { active: false });
    expect(off.status).toBe(200);
    expect(MemberSchema.strict().parse(await off.json())).toEqual({
      id: target.id,
      name: target.name,
      email: target.email,
      role,
      active: false,
    });
    expect(await isActive(target)).toBe(false);

    const on = await patch(target.id, { active: true });
    expect(on.status).toBe(200);
    expect(MemberSchema.parse(await on.json()).active).toBe(true);
    expect(await isActive(target)).toBe(true);
  });

  it("sobre otro bibliotecario: 403 con el mensaje de personal y nada cambia", async () => {
    const other = await currentWorld().addPerson("BIBLIOTECARIO");

    const response = await patch(other.id, { active: false });

    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe("Un bibliotecario no puede cambiar el estado de otro personal.");
    expect(await isActive(other)).toBe(true);
  });

  it("sobre otro bibliotecario ya inactivo, pedir reactivarlo: 403 y sigue inactivo", async () => {
    const other = await currentWorld().addWithState("BIBLIOTECARIO", false);

    expect((await patch(other.id, { active: true })).status).toBe(403);
    expect(await isActive(other)).toBe(false);
  });

  it("sobre el administrador: 403 «El administrador no se puede desactivar.» y nada cambia", async () => {
    const admin = await currentWorld().addPerson("ADMINISTRADOR");

    const response = await patch(admin.id, { active: false });

    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe("El administrador no se puede desactivar.");
    expect(await isActive(admin)).toBe(true);
  });

  it("sobre sí mismo: 403 «No puedes cambiar el estado de tu propia cuenta.» y sigue activo", async () => {
    const response = await patch(librarian.id, { active: false });

    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe("No puedes cambiar el estado de tu propia cuenta.");
    expect(await isActive(librarian)).toBe(true);
  });
});

describe("F14 · PATCH · matriz de la regla 7 por HTTP: administrador", () => {
  let admin: StaffPerson;

  beforeEach(async () => {
    admin = await signInAs("ADMINISTRADOR");
  });

  it.each([...BORROWERS, "BIBLIOTECARIO"] satisfies Role[])("desactiva y reactiva a un %s: 200", async (role) => {
    const target = await currentWorld().addPerson(role);

    expect((await patch(target.id, { active: false })).status).toBe(200);
    expect(await isActive(target)).toBe(false);
    const on = await patch(target.id, { active: true });
    expect(on.status).toBe(200);
    expect(MemberSchema.parse(await on.json())).toMatchObject({ role, active: true });
    expect(await isActive(target)).toBe(true);
  });

  it("sobre sí mismo: 403 «El administrador no se puede desactivar.» y sigue activo", async () => {
    const response = await patch(admin.id, { active: false });

    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe("El administrador no se puede desactivar.");
    expect(await isActive(admin)).toBe(true);
  });

  it("pedir reactivarse a sí mismo también es 403 (no es una excepción)", async () => {
    expect((await patch(admin.id, { active: true })).status).toBe(403);
  });
});

describe("F14 · PATCH · validación y 404 (reglas 6 y 8)", () => {
  beforeEach(async () => {
    await signInAs("BIBLIOTECARIO");
  });

  it("una cuenta inexistente: 404 «La cuenta no existe.»", async () => {
    const response = await patch("no-existe", { active: false });

    expect(response.status).toBe(404);
    expect(await errorOf(response)).toBe("La cuenta no existe.");
  });

  it("un :id de 128 caracteres es válido: si no existe, 404", async () => {
    expect((await patch("x".repeat(128), { active: false })).status).toBe(404);
  });

  it.each([
    ["con «/»", "a/b"],
    ["de 129 caracteres", "x".repeat(129)],
    ["reservado «.»", "."],
    ["reservado «..»", ".."],
    ["reservado «__x__»", "__x__"],
  ])("un :id %s: 400", async (_name, id) => {
    const response = await patch(id, { active: false });

    expect(response.status).toBe(400);
    expect(ApiErrorSchema.safeParse(await response.json()).success).toBe(true);
  });

  it.each([
    ["active ausente", {}],
    ["active null", { active: null }],
    ["active como cadena", { active: "true" }],
    ["active como número", { active: 1 }],
    ["active como arreglo", { active: [true] }],
    ["otro campo en lugar de active", { activo: true }],
  ] satisfies [string, Json][])("%s: 400 y nada cambia", async (_name, body) => {
    const student = await currentWorld().addPerson("ESTUDIANTE");

    const response = await patch(student.id, body);

    expect(response.status).toBe(400);
    expect(await isActive(student)).toBe(true);
  });

  it.each([
    ["cuerpo vacío", ""],
    ["cuerpo que no es JSON", "esto no es json"],
    ["un arreglo", "[]"],
    ["null", "null"],
    ["un texto", '"texto"'],
  ])("%s: 400", async (_name, raw) => {
    const student = await currentWorld().addPerson("ESTUDIANTE");

    expect((await patchRaw(student.id, raw)).status).toBe(400);
    expect(await isActive(student)).toBe(true);
  });

  it("sin cuerpo ni Content-Type: 400", async () => {
    const student = await currentWorld().addPerson("ESTUDIANTE");

    expect((await patchRaw(student.id, null, { origin: "http://localhost" })).status).toBe(400);
  });

  it("la validación va antes que el 404: id inexistente con cuerpo inválido da 400", async () => {
    expect((await patch("no-existe", { active: "no" })).status).toBe(400);
  });

  it("la validación va antes que la matriz: bibliotecario sobre el administrador con cuerpo inválido da 400", async () => {
    const admin = await currentWorld().addPerson("ADMINISTRADOR");

    expect((await patch(admin.id, {})).status).toBe(400);
  });

  it("el 404 va antes que la matriz: un id inexistente nunca da 403", async () => {
    expect((await patch("no-existe", { active: true })).status).toBe(404);
  });

  it("campos extra en el cuerpo se ignoran: role y name no cambian", async () => {
    const student = await currentWorld().addPerson("ESTUDIANTE");

    const response = await patch(student.id, { active: false, role: "ADMINISTRADOR", name: "Otro", email: "x@y.com" });

    expect(response.status).toBe(200);
    expect(MemberSchema.parse(await response.json())).toEqual({
      id: student.id,
      name: student.name,
      email: student.email,
      role: "ESTUDIANTE",
      active: false,
    });
  });
});

describe("F14 · PATCH · idempotencia y concurrencia (regla 9)", () => {
  beforeEach(async () => {
    await signInAs("BIBLIOTECARIO");
  });

  it("pedir el estado que la cuenta ya tiene: 200 con la cuenta, sin escribir", async () => {
    const inactive = await currentWorld().addWithState("ESTUDIANTE", false);
    const write = vi.spyOn(currentWorld().repos.members, "setActive");

    const response = await patch(inactive.id, { active: false });

    expect(response.status).toBe(200);
    expect(MemberSchema.parse(await response.json())).toMatchObject({ id: inactive.id, active: false });
    expect(write).not.toHaveBeenCalled();
  });

  it("reactivar una cuenta que nunca se desactivó: 200 sin escribir", async () => {
    const student = await currentWorld().addPerson("ESTUDIANTE");
    const write = vi.spyOn(currentWorld().repos.members, "setActive");

    expect((await patch(student.id, { active: true })).status).toBe(200);
    expect(write).not.toHaveBeenCalled();
  });

  it("repetir la desactivación dos veces: las dos dan 200", async () => {
    const student = await currentWorld().addPerson("ESTUDIANTE");

    expect((await patch(student.id, { active: false })).status).toBe(200);
    expect((await patch(student.id, { active: false })).status).toBe(200);
    expect(await isActive(student)).toBe(false);
  });

  it("la matriz va antes que la idempotencia: bibliotecario sobre el administrador (ya activo) pidiendo active=true: 403", async () => {
    const admin = await currentWorld().addPerson("ADMINISTRADOR");

    expect((await patch(admin.id, { active: true })).status).toBe(403);
  });

  it("dos cambios opuestos a la vez: ambos 200", async () => {
    const student = await currentWorld().addPerson("ESTUDIANTE");

    const responses = await Promise.all([patch(student.id, { active: false }), patch(student.id, { active: true })]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
  });
});

describe("F14 · PATCH · efectos en la sesión y el ingreso (regla 10)", () => {
  it("la persona desactivada recibe 401 en su siguiente petición y recupera la sesión al reactivarla", async () => {
    const librarian = await signInAs("BIBLIOTECARIO");
    const student = await currentWorld().addPerson("ESTUDIANTE");
    const studentCookie = await currentWorld().sessionCookieFor(student);
    holder.cookie = studentCookie;
    expect((await patch(librarian.id, { active: false })).status).toBe(403);

    await signInPerson(librarian);
    expect((await patch(student.id, { active: false })).status).toBe(200);

    holder.cookie = studentCookie;
    expect((await patch(librarian.id, { active: false })).status).toBe(401);

    await signInPerson(librarian);
    expect((await patch(student.id, { active: true })).status).toBe(200);
    holder.cookie = studentCookie;
    expect((await patch(librarian.id, { active: false })).status).toBe(403);
  });

  it("una sesión de personal desactivada por el administrador recibe 401 en la siguiente petición", async () => {
    const admin = await currentWorld().addPerson("ADMINISTRADOR");
    const librarian = await currentWorld().addPerson("BIBLIOTECARIO");
    const student = await currentWorld().addPerson("ESTUDIANTE");
    await signInPerson(librarian);
    expect((await patch(student.id, { active: false })).status).toBe(200);
    const librarianCookie = holder.cookie;

    await signInPerson(admin);
    expect((await patch(librarian.id, { active: false })).status).toBe(200);

    holder.cookie = librarianCookie;
    expect((await patch(student.id, { active: true })).status).toBe(401);
    expect(await isActive(student)).toBe(false);
    expect((await membersRoute(new NextRequest("http://localhost/api/members"))).status).toBe(401);
  });

  it("la cuenta desactivada no puede ingresar y reactivada vuelve a ingresar con el mismo rol", async () => {
    await signInAs("BIBLIOTECARIO");
    const teacher = await currentWorld().addPerson("DOCENTE");
    const idToken = await currentWorld().identity.signIn(teacher.email, "clave-segura-123");

    expect((await patch(teacher.id, { active: false })).status).toBe(200);
    await expect(currentWorld().auth.login({ id_token: idToken ?? "" })).rejects.toThrow("Credenciales inválidas");

    expect((await patch(teacher.id, { active: true })).status).toBe(200);
    expect((await currentWorld().auth.login({ id_token: idToken ?? "" })).member.role).toBe("DOCENTE");
  });

  it("el cambio se ve en el listado de cuentas (GET /api/members)", async () => {
    await signInAs("BIBLIOTECARIO");
    const student = await currentWorld().addPerson("ESTUDIANTE");
    await patch(student.id, { active: false });

    const page = await membersRoute(new NextRequest("http://localhost/api/members"));

    const members = MemberPageSchema.parse(await page.json()).members;
    expect(members.find((member) => member.id === student.id)?.active).toBe(false);
  });
});

describe("F14 · PATCH · errores internos", () => {
  it("si la escritura falla: 500 sin detalle y la cuenta sigue como estaba", async () => {
    await signInAs("BIBLIOTECARIO");
    const student = await currentWorld().addPerson("ESTUDIANTE");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(currentWorld().repos.members, "setActive").mockRejectedValueOnce(new Error("Firestore caído"));

    const response = await patch(student.id, { active: false });

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("Firestore");
    expect(await isActive(student)).toBe(true);
  });
});
