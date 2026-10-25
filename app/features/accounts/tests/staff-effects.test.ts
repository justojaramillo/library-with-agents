import { describe, expect, it } from "vitest";
import { actorOf, DAY_MS, makeLoanWorld, NOW } from "@/tests/helpers/loans";
import { makeStaffWorld } from "@/tests/helpers/staff";
import { makeTeacherWorld } from "@/tests/helpers/teacher-requests";
import { ConflictError, UnauthorizedError } from "@/shared/server/errors";
import { createSessionResolver } from "@/shared/server/security/session";

describe("F14 · efecto sobre el ingreso (regla 10)", () => {
  it("una cuenta desactivada no puede ingresar: «Credenciales inválidas»", async () => {
    const w = makeStaffWorld();
    const librarian = await w.addPerson("BIBLIOTECARIO");
    const student = await w.addPerson("ESTUDIANTE");
    await w.staff.setActive(librarian.actor, student.id, false);
    const idToken = await w.identity.signIn(student.email, "clave-segura-123");

    const attempt = w.auth.login({ id_token: idToken ?? "" });

    await expect(attempt).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(attempt).rejects.toThrow("Credenciales inválidas");
  });

  it("al reactivarla vuelve a ingresar con el mismo rol", async () => {
    const w = makeStaffWorld();
    const admin = await w.addPerson("ADMINISTRADOR");
    const teacher = await w.addPerson("DOCENTE");
    await w.staff.setActive(admin.actor, teacher.id, false);
    await w.staff.setActive(admin.actor, teacher.id, true);
    const idToken = await w.identity.signIn(teacher.email, "clave-segura-123");

    const login = await w.auth.login({ id_token: idToken ?? "" });

    expect(login.member).toMatchObject({ id: teacher.id, role: "DOCENTE", active: true });
    expect(login.sessionCookie).not.toBe("");
  });

  it("un bibliotecario desactivado por el administrador tampoco ingresa, y reactivado sí", async () => {
    const w = makeStaffWorld();
    const admin = await w.addPerson("ADMINISTRADOR");
    const librarian = await w.addPerson("BIBLIOTECARIO");
    await w.staff.setActive(admin.actor, librarian.id, false);
    const idToken = await w.identity.signIn(librarian.email, "clave-segura-123");

    await expect(w.auth.login({ id_token: idToken ?? "" })).rejects.toBeInstanceOf(UnauthorizedError);

    await w.staff.setActive(admin.actor, librarian.id, true);
    expect((await w.auth.login({ id_token: idToken ?? "" })).member.role).toBe("BIBLIOTECARIO");
  });
});

describe("F14 · efecto sobre la sesión abierta (regla 10)", () => {
  it("la cookie deja de valer en la siguiente resolución y vuelve a valer al reactivar, con el mismo rol", async () => {
    const w = makeStaffWorld();
    const librarian = await w.addPerson("BIBLIOTECARIO");
    const student = await w.addPerson("ESTUDIANTE");
    const cookie = await w.sessionCookieFor(student);
    const resolve = createSessionResolver({
      verifySessionCookie: (value) => w.identity.verifySessionCookie(value),
      loadMember: (uid) => w.repos.members.findById(uid),
    });
    expect(await resolve(cookie)).toEqual({ member_id: student.id, role: "ESTUDIANTE" });

    await w.staff.setActive(librarian.actor, student.id, false);
    expect(await resolve(cookie)).toBeNull();

    await w.staff.setActive(librarian.actor, student.id, true);
    expect(await resolve(cookie)).toEqual({ member_id: student.id, role: "ESTUDIANTE" });
  });
});

describe("F14 · efecto sobre los préstamos (regla 10, F5 y F6)", () => {
  it("una cuenta desactivada no puede pedir prestado: 409 «La cuenta está inactiva»", async () => {
    const lw = makeLoanWorld();
    const sw = makeStaffWorld(lw);
    const librarian = await lw.addMember("BIBLIOTECARIO");
    const student = await lw.addMember("ESTUDIANTE");
    const book = await lw.addBook(2);
    await sw.staff.setActive(actorOf(librarian), student.id, false);

    const attempt = lw.service.lend({ member_id: student.id, book_id: book.id }, actorOf(librarian), NOW);

    await expect(attempt).rejects.toBeInstanceOf(ConflictError);
    await expect(attempt).rejects.toThrow("La cuenta está inactiva");
    expect(await lw.repos.loans.listActiveByMember(student.id)).toHaveLength(0);
  });

  it("al reactivarla puede pedir prestado otra vez", async () => {
    const lw = makeLoanWorld();
    const sw = makeStaffWorld(lw);
    const librarian = await lw.addMember("BIBLIOTECARIO");
    const student = await lw.addMember("ESTUDIANTE");
    const book = await lw.addBook(1);
    await sw.staff.setActive(actorOf(librarian), student.id, false);
    await sw.staff.setActive(actorOf(librarian), student.id, true);

    const loan = await lw.service.lend({ member_id: student.id, book_id: book.id }, actorOf(librarian), NOW);

    expect(loan.member_id).toBe(student.id);
  });

  it("sus préstamos abiertos siguen abiertos y el personal puede recibir la devolución", async () => {
    const lw = makeLoanWorld();
    const sw = makeStaffWorld(lw);
    const librarian = await lw.addMember("BIBLIOTECARIO");
    const student = await lw.addMember("ESTUDIANTE");
    const book = await lw.addBook(1);
    const loan = await lw.seedLoan(student.id, book.id);

    await sw.staff.setActive(actorOf(librarian), student.id, false);

    expect((await lw.repos.loans.listActiveByMember(student.id)).map((item) => item.id)).toEqual([loan.id]);
    const returned = await lw.service.returnLoan(loan.id, actorOf(librarian), NOW);
    expect(returned.loan.returned_at).toBe(NOW.toISOString());
    expect(await lw.repos.loans.listActiveByMember(student.id)).toHaveLength(0);
  });

  it("desactivar a quien tiene un préstamo vencido es posible y el préstamo sigue vencido y devolvible", async () => {
    const lw = makeLoanWorld();
    const sw = makeStaffWorld(lw);
    const librarian = await lw.addMember("BIBLIOTECARIO");
    const student = await lw.addMember("ESTUDIANTE");
    const book = await lw.addBook(1);
    const loan = await lw.seedLoan(student.id, book.id, {
      loaned_at: new Date(NOW.getTime() - 10 * DAY_MS).toISOString(),
      due_at: new Date(NOW.getTime() - 3 * DAY_MS).toISOString(),
    });

    const result = await sw.staff.setActive(actorOf(librarian), student.id, false);

    expect(result.active).toBe(false);
    const overdue = await lw.service.listOverdue(student.id, actorOf(librarian), NOW);
    expect(overdue.map((item) => item.loan.id)).toEqual([loan.id]);
    const returned = await lw.service.returnLoan(loan.id, actorOf(librarian), NOW);
    expect(returned.fine_cop).toBeGreaterThan(0);
  });
});

describe("F14 · efecto sobre la solicitud de docente (regla 10, F12)", () => {
  it("la solicitud pendiente de una cuenta desactivada sigue pendiente, pero aprobarla da 409 y no cambia el rol", async () => {
    const tw = makeTeacherWorld();
    const sw = makeStaffWorld(tw);
    const librarian = await tw.addPerson("BIBLIOTECARIO");
    const student = await tw.addPerson("ESTUDIANTE");
    await tw.ask(student);

    await sw.staff.setActive(librarian.actor, student.id, false);

    expect((await tw.requests.get(student.id))?.status).toBe("PENDIENTE");
    const approval = tw.service.approve(librarian.actor, student.id, NOW);
    await expect(approval).rejects.toBeInstanceOf(ConflictError);
    await expect(approval).rejects.toThrow("La cuenta ya no puede recibir el rol de docente.");
    expect((await tw.requests.get(student.id))?.status).toBe("PENDIENTE");
    expect(await tw.roleOf(student)).toBe("ESTUDIANTE");
  });

  it("al reactivar la cuenta, la solicitud pendiente se puede aprobar", async () => {
    const tw = makeTeacherWorld();
    const sw = makeStaffWorld(tw);
    const librarian = await tw.addPerson("BIBLIOTECARIO");
    const student = await tw.addPerson("ESTUDIANTE");
    await tw.ask(student);
    await sw.staff.setActive(librarian.actor, student.id, false);
    await sw.staff.setActive(librarian.actor, student.id, true);

    const approved = await tw.service.approve(librarian.actor, student.id, NOW);

    expect(approved.status).toBe("APROBADA");
    expect(await tw.roleOf(student)).toBe("DOCENTE");
  });

  it("rechazar la solicitud de una cuenta desactivada sigue siendo posible", async () => {
    const tw = makeTeacherWorld();
    const sw = makeStaffWorld(tw);
    const librarian = await tw.addPerson("BIBLIOTECARIO");
    const student = await tw.addPerson("ESTUDIANTE");
    await tw.ask(student);
    await sw.staff.setActive(librarian.actor, student.id, false);

    const rejected = await tw.service.reject(librarian.actor, student.id, {}, NOW);

    expect(rejected.status).toBe("RECHAZADA");
  });
});
