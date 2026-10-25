import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import type { Role } from "@/shared/schema";
import { ConflictError, ForbiddenError } from "@/shared/server/errors";
import { countOk, outcomeOf } from "@/tests/helpers/teacher-requests";
import {
  emailOfLength,
  failingCreateRepository,
  makeStaffWorld,
  PASSWORD,
  type StaffPerson,
  type StaffWorld,
} from "@/tests/helpers/staff";
import { createMemberService } from "../server/member-service";
import { createStaffService } from "../server/staff-service";
import { CreateStaffInputSchema, MemberSchema } from "../schema";

const CREATE_MESSAGE = "Solo el administrador crea bibliotecarios.";
const DUPLICATE_MESSAGE = "Ya existe una cuenta con ese correo.";
const NON_ADMINS = ["BIBLIOTECARIO", "EXTERNO", "ESTUDIANTE", "DOCENTE"] satisfies Role[];

let w: StaffWorld;
let admin: StaffPerson;

beforeEach(async () => {
  w = makeStaffWorld();
  admin = await w.addPerson("ADMINISTRADOR");
});

function valid(over: { name?: string; email?: string; password?: string; role?: string } = {}) {
  return { name: "Lucía Fernández", email: "lucia@example.com", password: PASSWORD, ...over };
}

async function accountCount(): Promise<number> {
  return (await w.repos.members.list(500)).members.length;
}

async function rejectionOf<T>(promise: Promise<T>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
  }
  throw new Error("Se esperaba un rechazo y la operación terminó bien");
}

describe("F13 · el contrato de entrada del alta de bibliotecario", () => {
  it("el esquema no tiene campo de rol: el rol enviado no aparece en el resultado", () => {
    const parsed = CreateStaffInputSchema.parse({ ...valid(), role: "ADMINISTRADOR" });

    expect(Object.keys(parsed).sort()).toEqual(["email", "name", "password"]);
  });
});

describe("F13 · caso feliz (reglas 1 y 3)", () => {
  it("el administrador crea una cuenta BIBLIOTECARIO activa con los datos recibidos", async () => {
    const created = await w.staff.create(admin.actor, valid());

    expect(MemberSchema.strict().parse(created)).toMatchObject({
      name: "Lucía Fernández",
      email: "lucia@example.com",
      role: "BIBLIOTECARIO",
      active: true,
    });
    expect(await w.repos.members.findById(created.id)).toEqual(created);
  });

  it("la persona creada puede ingresar con el correo y la contraseña que eligió el administrador", async () => {
    const created = await w.staff.create(admin.actor, valid());

    const idToken = await w.identity.signIn("lucia@example.com", PASSWORD);
    expect(idToken).not.toBeNull();
    const login = await w.auth.login({ id_token: idToken ?? "" });
    expect(login.member).toEqual(created);
    expect(login.member.role).toBe("BIBLIOTECARIO");
  });

  it("guarda el nombre recortado y el correo recortado y en minúsculas", async () => {
    const created = await w.staff.create(admin.actor, valid({ name: "  Lucía  ", email: "  LUCIA@Example.COM  " }));

    expect(created.name).toBe("Lucía");
    expect(created.email).toBe("lucia@example.com");
  });

  it("no devuelve la contraseña ni la guarda en el repositorio", async () => {
    const created = await w.staff.create(admin.actor, valid());

    expect(JSON.stringify(created)).not.toContain(PASSWORD);
    expect(JSON.stringify(await w.repos.members.findById(created.id))).not.toContain(PASSWORD);
  });

  it.each([
    "ADMINISTRADOR",
    "DOCENTE",
    "EXTERNO",
    "ESTUDIANTE",
    "BIBLIOTECARIO",
    "SUPERUSUARIO",
    "",
  ])("un role «%s» en la entrada se ignora y la cuenta es BIBLIOTECARIO", async (role) => {
    const created = await w.staff.create(admin.actor, valid({ role }));

    expect(created.role).toBe("BIBLIOTECARIO");
    expect((await w.repos.members.findById(created.id))?.role).toBe("BIBLIOTECARIO");
  });

  it("con role ADMINISTRADOR no se crea un segundo administrador ni falla por «ya hay uno»", async () => {
    await w.staff.create(admin.actor, valid({ role: "ADMINISTRADOR" }));

    expect((await w.repos.members.list(500)).members.filter((member) => member.role === "ADMINISTRADOR")).toHaveLength(
      1,
    );
  });

  it("los campos extra (active, id) no cambian el resultado: queda activa y con el id de la identidad", async () => {
    const withExtras = { ...valid(), active: false, id: "id-elegido", member_id: "otro" };

    const created = await w.staff.create(admin.actor, withExtras);

    expect(created.active).toBe(true);
    expect(created.id).not.toBe("id-elegido");
    expect(await w.repos.members.findById("id-elegido")).toBeUndefined();
  });

  it("crear varios bibliotecarios es posible: cada uno con su correo", async () => {
    await w.staff.create(admin.actor, valid());
    await w.staff.create(admin.actor, valid({ email: "otra@example.com" }));

    const staff = await w.staff.list(admin.actor);
    expect(staff.filter((member) => member.role === "BIBLIOTECARIO")).toHaveLength(2);
  });
});

describe("F13 · autorización (regla 2)", () => {
  it.each(NON_ADMINS)("un %s recibe 403 «Solo el administrador crea bibliotecarios.»", async (role) => {
    const actor = await w.addPerson(role);
    const before = await accountCount();

    const error = await rejectionOf(w.staff.create(actor.actor, valid()));

    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.message).toBe(CREATE_MESSAGE);
    expect(await accountCount()).toBe(before);
    expect(await w.identity.signIn("lucia@example.com", PASSWORD)).toBeNull();
  });

  it.each(NON_ADMINS)("un %s recibe 403 (y no 400) aunque la entrada sea inválida", async (role) => {
    const actor = await w.addPerson(role);

    await expect(w.staff.create(actor.actor, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(w.staff.create(actor.actor, valid({ password: "corta" }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("un bibliotecario no puede crear otro aunque pida role BIBLIOTECARIO o ADMINISTRADOR", async () => {
    const librarian = await w.addPerson("BIBLIOTECARIO");

    await expect(w.staff.create(librarian.actor, valid({ role: "ADMINISTRADOR" }))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("F13 · correo repetido (regla 3)", () => {
  it.each([
    ["el mismo", "lucia@example.com"],
    ["con otras mayúsculas", "LUCIA@EXAMPLE.COM"],
    ["con espacios", "  lucia@example.com  "],
  ])("un correo %s: 409 y no hay segunda cuenta", async (_name, email) => {
    await w.staff.create(admin.actor, valid());
    const before = await accountCount();

    const error = await rejectionOf(w.staff.create(admin.actor, valid({ name: "Otra Persona", email })));

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).toBe(DUPLICATE_MESSAGE);
    expect(await accountCount()).toBe(before);
  });

  it("el correo de una cuenta de cualquier otro rol también da 409", async () => {
    const student = await w.addPerson("ESTUDIANTE");

    await expect(w.staff.create(admin.actor, valid({ email: student.email.toUpperCase() }))).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("el correo del propio administrador da 409", async () => {
    await expect(w.staff.create(admin.actor, valid({ email: admin.email }))).rejects.toBeInstanceOf(ConflictError);
  });

  it("dos altas simultáneas con el mismo correo: una se crea y la otra da 409", async () => {
    const outcomes = await Promise.all([
      outcomeOf(w.staff.create(admin.actor, valid())),
      outcomeOf(w.staff.create(admin.actor, valid({ name: "Gemela" }))),
    ]);

    expect(countOk(outcomes)).toBe(1);
    const failed = outcomes.flatMap((outcome) => {
      if (outcome.ok) {
        return [];
      }
      return [outcome.error];
    });
    expect(failed[0]).toBeInstanceOf(ConflictError);
    expect(await accountCount()).toBe(2);
  });
});

describe("F13 · límites de los campos (bordes)", () => {
  it.each([
    [7, false],
    [8, true],
    [100, true],
    [101, false],
  ])("contraseña de %i caracteres: aceptada=%s", async (length, accepted) => {
    const result = outcomeOf(w.staff.create(admin.actor, valid({ password: "p".repeat(length) })));

    const outcome = await result;
    expect(outcome.ok).toBe(accepted);
    if (!outcome.ok) {
      expect(outcome.error).toBeInstanceOf(ZodError);
      expect(await w.identity.signIn("lucia@example.com", "p".repeat(length))).toBeNull();
    }
  });

  it.each([
    [1, true],
    [120, true],
    [121, false],
  ])("nombre de %i caracteres: aceptado=%s", async (length, accepted) => {
    const outcome = await outcomeOf(w.staff.create(admin.actor, valid({ name: "n".repeat(length) })));

    expect(outcome.ok).toBe(accepted);
  });

  it.each(["", "     ", "\t\n"])("nombre «%s» (vacío o solo espacios): error de validación", async (name) => {
    await expect(w.staff.create(admin.actor, valid({ name }))).rejects.toBeInstanceOf(ZodError);
    expect(await accountCount()).toBe(1);
  });

  it.each([
    [254, true],
    [255, false],
  ])("correo de %i caracteres: aceptado=%s", async (length, accepted) => {
    const email = emailOfLength(length);
    expect(email).toHaveLength(length);

    const outcome = await outcomeOf(w.staff.create(admin.actor, valid({ email })));

    expect(outcome.ok).toBe(accepted);
  });

  it.each([
    "no-es-correo",
    "lucia@",
    "@example.com",
    "lucia@example",
    "",
  ])("correo «%s»: error de validación", async (email) => {
    await expect(w.staff.create(admin.actor, valid({ email }))).rejects.toBeInstanceOf(ZodError);
  });

  it.each(["name", "email", "password"] as const)("sin el campo %s: error de validación", async (field) => {
    const input = valid();
    const incomplete = { ...input, [field]: undefined };

    await expect(w.staff.create(admin.actor, incomplete)).rejects.toBeInstanceOf(ZodError);
    expect(await accountCount()).toBe(1);
  });
});

describe("F13 · atomicidad del alta (regla 3)", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  function brokenStaff() {
    const failing = failingCreateRepository(w.repos.members);
    const provision = createMemberService({ members: failing, identity: w.identity }).provision;
    return createStaffService({ members: w.repos.members, provision });
  }

  it("si guardar el documento falla, el error se propaga, la identidad se borra y no queda cuenta", async () => {
    const before = await accountCount();

    await expect(brokenStaff().create(admin.actor, valid({ email: "caida@example.com" }))).rejects.toThrow("Firestore");

    expect(await w.identity.signIn("caida@example.com", PASSWORD)).toBeNull();
    expect(await accountCount()).toBe(before);
  });

  it("tras el fallo el mismo correo puede volver a usarse", async () => {
    await expect(brokenStaff().create(admin.actor, valid({ email: "caida@example.com" }))).rejects.toThrow();

    const retry = await w.staff.create(admin.actor, valid({ email: "caida@example.com" }));

    expect(retry.role).toBe("BIBLIOTECARIO");
    expect(await w.identity.signIn("caida@example.com", PASSWORD)).not.toBeNull();
  });
});
