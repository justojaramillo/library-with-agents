import { describe, expect, it } from "vitest";
import { CreateMemberInputSchema, ProvisionMemberInputSchema } from "@/features/accounts/schema";
import { createMemberService } from "@/features/accounts/server/member-service";
import type { MemberRecord, MemberRepository } from "@/features/accounts/server/repository";
import { ROLES, type Role } from "@/shared/schema";
import { ConflictError, UnauthorizedError } from "@/shared/server/errors";
import { createSessionResolver } from "@/shared/server/security/session";
import { aMember, aProvisionedMember, makeWorld, type World } from "@/tests/helpers/factories";

const NON_SELECTABLE_ROLES: readonly string[] = [
  "DOCENTE",
  "BIBLIOTECARIO",
  "ADMINISTRADOR",
  "SUPERUSUARIO",
  "SOCIO",
  "externo",
  "",
];

/** Ingreso completo como lo haría el navegador: correo y contraseña contra la identidad, luego el servidor. */
async function loginAs(world: World, email: string, password: string) {
  const idToken = await world.identity.signIn(email, password);
  if (idToken === null) {
    throw new Error(`La identidad no reconoció a ${email}`);
  }
  return world.auth.login({ id_token: idToken });
}

/** Repositorio que delega en otro pero cuyo `create` siempre falla (simula una caída de Firestore). */
function failingCreate(inner: MemberRepository): MemberRepository {
  return {
    create: async (record: MemberRecord) => {
      throw new Error(`Firestore caído al guardar ${record.email}`);
    },
    findById: (id) => inner.findById(id),
    findByEmail: (email) => inner.findByEmail(email),
    existsWithRole: (role) => inner.existsWithRole(role),
    list: () => inner.list(),
  };
}

/** Servicio de cuentas cuyo repositorio falla al guardar; comparte la identidad y las cuentas del mundo. */
function createFailingMemberService(world: World) {
  return createMemberService({ members: failingCreate(world.repos.members), identity: world.identity });
}

describe("F3 · registrar cuenta con rol seleccionable", () => {
  it("registra a una persona sin rol como EXTERNO y con la cuenta activa", async () => {
    const { members } = makeWorld();
    const withoutRole = CreateMemberInputSchema.parse({
      name: "Persona Sin Rol",
      email: "sinrol@example.com",
      password: "clave-segura-123",
    });
    const created = await members.register(withoutRole);
    expect(created.role).toBe("EXTERNO");
    expect(created.active).toBe(true);
  });

  it("registra a una persona con rol ESTUDIANTE y la cuenta queda activa", async () => {
    const { members } = makeWorld();
    const created = await members.register(aMember({ role: "ESTUDIANTE" }));
    expect(created.role).toBe("ESTUDIANTE");
    expect(created.active).toBe(true);
  });

  it("registra a una persona con rol EXTERNO explícito", async () => {
    const { members } = makeWorld();
    expect((await members.register(aMember({ role: "EXTERNO" }))).role).toBe("EXTERNO");
  });

  it("el id de la cuenta es texto (el uid de la identidad) y la cuenta se puede consultar por él", async () => {
    const { members } = makeWorld();
    const created = await members.register(aMember());
    expect(typeof created.id).toBe("string");
    expect(created.id.length).toBeGreaterThan(0);
    expect(await members.get(created.id)).toEqual(created);
    expect(await members.get("no-existe")).toBeUndefined();
  });

  it.each(NON_SELECTABLE_ROLES)("rechaza el rol «%s» por validación y no crea la cuenta", async (role) => {
    const { members, repos, identity } = makeWorld();
    const input = { ...aMember({ email: "intruso@example.com", password: "clave-segura-123" }), role };
    expect(CreateMemberInputSchema.safeParse(input).success).toBe(false);
    expect(await repos.members.findByEmail("intruso@example.com")).toBeUndefined();
    expect(await identity.signIn("intruso@example.com", "clave-segura-123")).toBeNull();
    expect(await members.list()).toHaveLength(0);
  });

  it("devuelve un error de validación que señala el campo role para un rol no seleccionable", () => {
    const validation = CreateMemberInputSchema.safeParse({ ...aMember(), role: "ADMINISTRADOR" });
    expect(validation.success).toBe(false);
    if (!validation.success) {
      expect(validation.error.issues.map((issue) => issue.path.join("."))).toContain("role");
    }
  });

  it("register revalida el rol: un ADMINISTRADOR que llegue sin pasar por el esquema no se crea", async () => {
    const { members, identity } = makeWorld();
    // @ts-expect-error el rol ADMINISTRADOR no es seleccionable: el servicio debe rechazarlo igualmente
    const attempt = members.register({ ...aMember({ email: "colado@example.com" }), role: "ADMINISTRADOR" });
    await expect(attempt).rejects.toThrow();
    expect(await members.list()).toHaveLength(0);
    expect(await identity.signIn("colado@example.com", "clave-segura-123")).toBeNull();
  });

  it("register revalida el rol: un DOCENTE que llegue sin pasar por el esquema no se crea", async () => {
    const { members } = makeWorld();
    // @ts-expect-error el rol DOCENTE no es seleccionable: el servicio debe rechazarlo igualmente
    const attempt = members.register({ ...aMember(), role: "DOCENTE" });
    await expect(attempt).rejects.toThrow();
    expect(await members.list()).toHaveLength(0);
  });

  it("guarda el correo en minúsculas", async () => {
    const { members } = makeWorld();
    const created = await members.register(aMember({ email: "Ana@Example.com" }));
    expect(created.email).toBe("ana@example.com");
  });

  it("rechaza un correo repetido aunque cambien las mayúsculas", async () => {
    const { members } = makeWorld();
    await members.register(aMember({ email: "a@example.com" }));
    await expect(members.register(aMember({ email: "a@example.com" }))).rejects.toThrow(ConflictError);
    await expect(members.register(aMember({ email: "A@EXAMPLE.COM" }))).rejects.toThrow(ConflictError);
    expect(await members.list()).toHaveLength(1);
  });

  it("rechaza un correo ya usado por una cuenta creada con provision", async () => {
    const { members } = makeWorld();
    await members.provision(aProvisionedMember({ email: "personal@example.com", role: "BIBLIOTECARIO" }));
    await expect(members.register(aMember({ email: "personal@example.com" }))).rejects.toThrow(ConflictError);
  });

  it("rechaza con ConflictError un correo que ya existe en la identidad aunque no tenga cuenta", async () => {
    const { members, identity } = makeWorld();
    await identity.createUser({ email: "huerfano@example.com", password: "otra-clave-123", name: "Huérfano" });
    await expect(members.register(aMember({ email: "huerfano@example.com" }))).rejects.toThrow(ConflictError);
    expect(await members.list()).toHaveLength(0);
  });

  it("rechaza con ConflictError en provision un correo que ya existe en la identidad", async () => {
    const { members, identity } = makeWorld();
    await identity.createUser({ email: "huerfano@example.com", password: "otra-clave-123", name: "Huérfano" });
    await expect(members.provision(aProvisionedMember({ email: "huerfano@example.com" }))).rejects.toThrow(
      ConflictError,
    );
    expect(await members.list()).toHaveLength(0);
  });

  it("rechaza un correo con formato inválido", async () => {
    const { members } = makeWorld();
    await expect(members.register(aMember({ email: "no-es-un-correo" }))).rejects.toThrow();
  });

  it("rechaza un nombre vacío", async () => {
    const { members } = makeWorld();
    await expect(members.register(aMember({ name: "   " }))).rejects.toThrow();
  });

  it("acepta contraseñas de 8 y de 100 caracteres, y rechaza de 7 y de 101", async () => {
    const { members } = makeWorld();
    await expect(members.register(aMember({ password: "a".repeat(8) }))).resolves.toBeDefined();
    await expect(members.register(aMember({ password: "a".repeat(100) }))).resolves.toBeDefined();
    await expect(members.register(aMember({ password: "a".repeat(7) }))).rejects.toThrow();
    await expect(members.register(aMember({ password: "a".repeat(101) }))).rejects.toThrow();
    expect(await members.list()).toHaveLength(2);
  });

  it("no expone la contraseña en la respuesta de registro", async () => {
    const { members } = makeWorld();
    const created = await members.register(aMember({ password: "clave-segura-123" }));
    expect(created).not.toHaveProperty("password");
    expect(created).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(created)).not.toContain("clave-segura-123");
  });

  it("no expone la contraseña al listar cuentas", async () => {
    const { members } = makeWorld();
    await members.register(aMember({ password: "clave-segura-123" }));
    await members.provision(aProvisionedMember({ role: "ADMINISTRADOR", password: "clave-segura-123" }));
    const listed = await members.list();
    expect(listed).toHaveLength(2);
    for (const member of listed) {
      expect(member).not.toHaveProperty("password");
      expect(member).not.toHaveProperty("passwordHash");
    }
    expect(JSON.stringify(listed)).not.toContain("clave-segura-123");
  });

  it("la app no guarda la contraseña: la cuenta guardada no la contiene y solo la identidad la conoce", async () => {
    const { members, repos, identity } = makeWorld();
    const created = await members.register(aMember({ email: "guarda@example.com", password: "clave-segura-123" }));
    const stored = await repos.members.findById(created.id);
    expect(stored).toBeDefined();
    expect(stored).not.toHaveProperty("password");
    expect(stored).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(stored)).not.toContain("clave-segura-123");
    expect(await identity.signIn("guarda@example.com", "clave-segura-123")).not.toBeNull();
    expect(await identity.signIn("guarda@example.com", "otra-clave-999")).toBeNull();
  });

  it("la cuenta guardada usa como id el uid que entregó la identidad", async () => {
    const { members, repos, identity } = makeWorld();
    const created = await members.register(aMember({ email: "uid@example.com", password: "clave-segura-123" }));
    const idToken = await identity.signIn("uid@example.com", "clave-segura-123");
    expect(idToken).not.toBeNull();
    expect((await repos.members.findById(created.id))?.email).toBe("uid@example.com");
    const verified = await identity.verifyIdToken(idToken ?? "");
    expect(verified?.uid).toBe(created.id);
  });
});

describe("F3 · compensación si falla guardar la cuenta", () => {
  it("si guardar la cuenta falla en register, la identidad creada se borra y el error se propaga", async () => {
    const world = makeWorld();
    const members = createFailingMemberService(world);
    await expect(
      members.register(aMember({ email: "caida@example.com", password: "clave-segura-123" })),
    ).rejects.toThrow("Firestore caído");
    expect(await world.identity.signIn("caida@example.com", "clave-segura-123")).toBeNull();
    expect(await world.members.list()).toHaveLength(0);
  });

  it("si guardar la cuenta falla en provision, la identidad creada se borra", async () => {
    const world = makeWorld();
    const members = createFailingMemberService(world);
    await expect(
      members.provision(
        aProvisionedMember({ email: "caida@example.com", password: "clave-segura-123", role: "DOCENTE" }),
      ),
    ).rejects.toThrow("Firestore caído");
    expect(await world.identity.signIn("caida@example.com", "clave-segura-123")).toBeNull();
  });

  it("tras una alta fallida se puede reintentar con el mismo correo sin chocar con una identidad huérfana", async () => {
    const world = makeWorld();
    const failing = createFailingMemberService(world);
    await expect(failing.register(aMember({ email: "reintento@example.com" }))).rejects.toThrow();
    const created = await world.members.register(aMember({ email: "reintento@example.com" }));
    expect(created.email).toBe("reintento@example.com");
  });

  it("si el segundo administrador se rechaza al guardar, su identidad tampoco queda creada", async () => {
    const { members, identity } = makeWorld();
    await members.provision(aProvisionedMember({ email: "admin1@example.com", role: "ADMINISTRADOR" }));
    await expect(
      members.provision(
        aProvisionedMember({ email: "admin2@example.com", password: "clave-segura-123", role: "ADMINISTRADOR" }),
      ),
    ).rejects.toThrow(ConflictError);
    expect(await identity.signIn("admin2@example.com", "clave-segura-123")).toBeNull();
  });
});

describe("F3 · provision crea cuentas con cualquier rol", () => {
  it.each(ROLES)("crea una cuenta activa con rol %s", async (role) => {
    const { members } = makeWorld();
    const created = await members.provision(aProvisionedMember({ role }));
    expect(created.role).toBe(role);
    expect(created.active).toBe(true);
  });

  it("guarda el correo en minúsculas y rechaza un correo repetido", async () => {
    const { members } = makeWorld();
    const created = await members.provision(aProvisionedMember({ email: "Admin@Example.com", role: "ADMINISTRADOR" }));
    expect(created.email).toBe("admin@example.com");
    await expect(members.provision(aProvisionedMember({ email: "admin@example.com" }))).rejects.toThrow(ConflictError);
  });

  it("no guarda ni devuelve la contraseña, que solo conoce la identidad", async () => {
    const { members, repos, identity } = makeWorld();
    const created = await members.provision(
      aProvisionedMember({ email: "doc@example.com", role: "DOCENTE", password: "clave-docente-1" }),
    );
    expect(created).not.toHaveProperty("password");
    expect(created).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(await repos.members.findById(created.id))).not.toContain("clave-docente-1");
    expect(await identity.signIn("doc@example.com", "clave-docente-1")).not.toBeNull();
  });

  it("rechaza un rol inventado y contraseñas fuera de rango", async () => {
    const { members } = makeWorld();
    expect(ProvisionMemberInputSchema.safeParse({ ...aProvisionedMember(), role: "SUPERUSUARIO" }).success).toBe(false);
    await expect(members.provision(aProvisionedMember({ password: "corta" }))).rejects.toThrow();
  });

  it("provision revalida el rol: un rol inventado que llegue sin pasar por el esquema no se crea", async () => {
    const { members } = makeWorld();
    // @ts-expect-error SUPERUSUARIO no es un rol del sistema: el servicio debe rechazarlo igualmente
    const attempt = members.provision({ ...aProvisionedMember(), role: "SUPERUSUARIO" });
    await expect(attempt).rejects.toThrow();
    expect(await members.list()).toHaveLength(0);
  });

  it("las cuentas creadas aparecen en la lista", async () => {
    const { members } = makeWorld();
    await members.register(aMember({ email: "uno@example.com" }));
    await members.provision(aProvisionedMember({ email: "dos@example.com", role: "BIBLIOTECARIO" }));
    expect((await members.list()).map((member) => member.email)).toEqual(["uno@example.com", "dos@example.com"]);
  });
});

describe("F3 · solo puede haber un ADMINISTRADOR", () => {
  it("provisiona el primer ADMINISTRADOR con normalidad", async () => {
    const { members } = makeWorld();
    const created = await members.provision(aProvisionedMember({ role: "ADMINISTRADOR" }));
    expect(created.role).toBe("ADMINISTRADOR");
    expect(created.active).toBe(true);
  });

  it("rechaza un segundo ADMINISTRADOR con correo distinto y no crea la cuenta", async () => {
    const { members, repos } = makeWorld();
    await members.provision(aProvisionedMember({ email: "admin1@example.com", role: "ADMINISTRADOR" }));
    await expect(
      members.provision(aProvisionedMember({ email: "admin2@example.com", role: "ADMINISTRADOR" })),
    ).rejects.toThrow(ConflictError);
    expect(await repos.members.findByEmail("admin2@example.com")).toBeUndefined();
    const listed = await members.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.email).toBe("admin1@example.com");
  });

  it("sigue rechazando un tercer ADMINISTRADOR y el primero permanece intacto", async () => {
    const { members } = makeWorld();
    const first = await members.provision(aProvisionedMember({ email: "admin1@example.com", role: "ADMINISTRADOR" }));
    await expect(members.provision(aProvisionedMember({ role: "ADMINISTRADOR" }))).rejects.toThrow(ConflictError);
    await expect(members.provision(aProvisionedMember({ role: "ADMINISTRADOR" }))).rejects.toThrow(ConflictError);
    const administrators = (await members.list()).filter((member) => member.role === "ADMINISTRADOR");
    expect(administrators).toHaveLength(1);
    expect(administrators[0]?.id).toBe(first.id);
  });

  it("crea con normalidad los demás roles aunque ya exista un ADMINISTRADOR", async () => {
    const { members } = makeWorld();
    await members.provision(aProvisionedMember({ email: "admin@example.com", role: "ADMINISTRADOR" }));
    const otherRoles = ROLES.filter((role) => role !== "ADMINISTRADOR");
    for (const role of otherRoles) {
      const created = await members.provision(aProvisionedMember({ role }));
      expect(created.role).toBe(role);
      expect(created.active).toBe(true);
    }
    expect(await members.list()).toHaveLength(1 + otherRoles.length);
  });

  it("permite varias cuentas de un mismo rol que no es ADMINISTRADOR", async () => {
    const { members } = makeWorld();
    await members.provision(aProvisionedMember({ role: "BIBLIOTECARIO" }));
    await members.provision(aProvisionedMember({ role: "BIBLIOTECARIO" }));
    expect((await members.list()).filter((member) => member.role === "BIBLIOTECARIO")).toHaveLength(2);
  });

  it("el ADMINISTRADOR puede provisionarse después de otros roles si aún no existe uno", async () => {
    const { members } = makeWorld();
    await members.provision(aProvisionedMember({ role: "DOCENTE" }));
    await members.provision(aProvisionedMember({ role: "BIBLIOTECARIO" }));
    const admin = await members.provision(aProvisionedMember({ role: "ADMINISTRADOR" }));
    expect(admin.role).toBe("ADMINISTRADOR");
  });

  it("con el mismo correo del administrador falla igualmente con ConflictError", async () => {
    const { members } = makeWorld();
    await members.provision(aProvisionedMember({ email: "admin@example.com", role: "ADMINISTRADOR" }));
    await expect(
      members.provision(aProvisionedMember({ email: "admin@example.com", role: "ADMINISTRADOR" })),
    ).rejects.toThrow(ConflictError);
    expect(await members.list()).toHaveLength(1);
  });

  it("el repositorio también se niega a guardar un segundo ADMINISTRADOR", async () => {
    const { repos } = makeWorld();
    await repos.members.create({
      id: "a-1",
      name: "Admin Uno",
      email: "a1@example.com",
      role: "ADMINISTRADOR",
      active: true,
    });
    await expect(
      repos.members.create({
        id: "a-2",
        name: "Admin Dos",
        email: "a2@example.com",
        role: "ADMINISTRADOR",
        active: true,
      }),
    ).rejects.toThrow(ConflictError);
    expect(await repos.members.list()).toHaveLength(1);
  });
});

describe("F4 · ingreso con el ID token de la identidad", () => {
  it.each(ROLES)("una cuenta %s ingresa con su contraseña y el ingreso devuelve ese rol", async (role: Role) => {
    const world = makeWorld();
    await world.members.provision(aProvisionedMember({ email: "cuenta@example.com", role, password: "secreta-1234" }));
    const logged = await loginAs(world, "cuenta@example.com", "secreta-1234");
    expect(logged.member.role).toBe(role);
    expect(logged.member.email).toBe("cuenta@example.com");
    expect(logged.sessionCookie.length).toBeGreaterThan(0);
  });

  it("una cuenta creada por register ingresa con login y conserva su rol", async () => {
    const world = makeWorld();
    const registered = await world.members.register(
      aMember({ email: "est@example.com", role: "ESTUDIANTE", password: "secreta-1234" }),
    );
    const logged = await loginAs(world, "est@example.com", "secreta-1234");
    expect(logged.member).toEqual(registered);
    expect(logged.member.role).toBe("ESTUDIANTE");
    expect(logged.member.active).toBe(true);
  });

  it("la cookie de sesión del ingreso pertenece a la cuenta que ingresó", async () => {
    const world = makeWorld();
    const registered = await world.members.register(aMember({ email: "yo@example.com", password: "secreta-1234" }));
    const logged = await loginAs(world, "yo@example.com", "secreta-1234");
    const verified = await world.identity.verifySessionCookie(logged.sessionCookie);
    expect(verified?.uid).toBe(registered.id);
  });

  it("el ingreso no expone la contraseña ni el ID token en la cuenta devuelta", async () => {
    const world = makeWorld();
    await world.members.provision(aProvisionedMember({ email: "x@example.com", password: "secreta-1234" }));
    const logged = await loginAs(world, "x@example.com", "secreta-1234");
    expect(logged.member).not.toHaveProperty("password");
    expect(logged.member).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(logged.member)).not.toContain("secreta-1234");
  });

  it("el correo del ingreso no distingue mayúsculas", async () => {
    const world = makeWorld();
    await world.members.register(aMember({ email: "mixto@example.com", password: "secreta-1234" }));
    const logged = await loginAs(world, "MIXTO@Example.com", "secreta-1234");
    expect(logged.member.email).toBe("mixto@example.com");
  });

  it("una contraseña errónea o un correo inexistente no obtienen ID token de la identidad", async () => {
    const { members, identity } = makeWorld();
    await members.register(aMember({ email: "x@example.com", password: "secreta-1234" }));
    expect(await identity.signIn("x@example.com", "otra-clave-99")).toBeNull();
    expect(await identity.signIn("nadie@example.com", "otra-clave-99")).toBeNull();
  });

  it("un ID token inválido da «Credenciales inválidas»", async () => {
    const { auth } = makeWorld();
    const attempt = auth.login({ id_token: "token-inventado" });
    await expect(attempt).rejects.toThrow(UnauthorizedError);
    await expect(attempt).rejects.toThrow("Credenciales inválidas");
  });

  it("un ID token vacío no pasa la validación", async () => {
    const { auth } = makeWorld();
    await expect(auth.login({ id_token: "" })).rejects.toThrow();
  });

  it("un ID token de una identidad sin cuenta guardada da «Credenciales inválidas»", async () => {
    const world = makeWorld();
    await world.identity.createUser({ email: "sincuenta@example.com", password: "secreta-1234", name: "Sin Cuenta" });
    const idToken = await world.identity.signIn("sincuenta@example.com", "secreta-1234");
    expect(idToken).not.toBeNull();
    const attempt = world.auth.login({ id_token: idToken ?? "" });
    await expect(attempt).rejects.toThrow(UnauthorizedError);
    await expect(attempt).rejects.toThrow("Credenciales inválidas");
  });

  it("una cuenta inactiva recibe «Credenciales inválidas» aunque la contraseña sea correcta", async () => {
    const world = makeWorld();
    const { uid } = await world.identity.createUser({
      email: "inactiva@example.com",
      password: "secreta-1234",
      name: "Persona Inactiva",
    });
    await world.repos.members.create({
      id: uid,
      name: "Persona Inactiva",
      email: "inactiva@example.com",
      role: "ESTUDIANTE",
      active: false,
    });
    const idToken = await world.identity.signIn("inactiva@example.com", "secreta-1234");
    expect(idToken).not.toBeNull();
    const attempt = world.auth.login({ id_token: idToken ?? "" });
    await expect(attempt).rejects.toThrow(UnauthorizedError);
    await expect(attempt).rejects.toThrow("Credenciales inválidas");
  });

  it("el mensaje de una cuenta inactiva es idéntico al de un token inválido o sin cuenta", async () => {
    const world = makeWorld();
    const { uid } = await world.identity.createUser({
      email: "i@example.com",
      password: "secreta-1234",
      name: "Inactiva",
    });
    await world.repos.members.create({
      id: uid,
      name: "Inactiva",
      email: "i@example.com",
      role: "DOCENTE",
      active: false,
    });
    const inactiveToken = await world.identity.signIn("i@example.com", "secreta-1234");
    const messages: string[] = [];
    for (const idToken of [inactiveToken ?? "", "token-inventado"]) {
      try {
        await world.auth.login({ id_token: idToken });
      } catch (error) {
        if (error instanceof UnauthorizedError) {
          messages.push(error.message);
        }
      }
    }
    expect(messages).toEqual(["Credenciales inválidas", "Credenciales inválidas"]);
  });

  it("una cuenta inactiva no obtiene cookie de sesión", async () => {
    const world = makeWorld();
    const { uid } = await world.identity.createUser({
      email: "i@example.com",
      password: "secreta-1234",
      name: "Inactiva",
    });
    await world.repos.members.create({
      id: uid,
      name: "Inactiva",
      email: "i@example.com",
      role: "EXTERNO",
      active: false,
    });
    await expect(loginAs(world, "i@example.com", "secreta-1234")).rejects.toThrow(UnauthorizedError);
  });
});

describe("F4 · de la cookie de sesión a la identidad de la petición (con identidad y cuentas en memoria)", () => {
  function resolverFor(world: World) {
    return createSessionResolver({
      verifySessionCookie: (cookie) => world.identity.verifySessionCookie(cookie),
      loadMember: (uid) => world.repos.members.findById(uid),
    });
  }

  it.each(ROLES)("tras ingresar como %s, la cookie resuelve a member_id y ese rol", async (role: Role) => {
    const world = makeWorld();
    const created = await world.members.provision(
      aProvisionedMember({ email: "cuenta@example.com", role, password: "secreta-1234" }),
    );
    const logged = await loginAs(world, "cuenta@example.com", "secreta-1234");
    expect(await resolverFor(world)(logged.sessionCookie)).toEqual({ member_id: created.id, role });
  });

  it("una cookie alterada no da sesión", async () => {
    const world = makeWorld();
    await world.members.register(aMember({ email: "cuenta@example.com", password: "secreta-1234" }));
    const logged = await loginAs(world, "cuenta@example.com", "secreta-1234");
    expect(await resolverFor(world)(`${logged.sessionCookie}x`)).toBeNull();
    expect(await resolverFor(world)("cookie-inventada")).toBeNull();
  });
});
