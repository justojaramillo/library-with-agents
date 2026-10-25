import { createAuthService } from "@/features/accounts/server/auth-service";
import { createMemberService } from "@/features/accounts/server/member-service";
import { createMemoryIdentityProvider } from "@/features/accounts/server/identity.memory";
import { createMemoryMemberRepository } from "@/features/accounts/server/repository.memory";
import type { CreateMemberInput, ProvisionMemberInput } from "@/features/accounts/schema";
import { createBookService } from "@/features/catalog/server/book-service";
import { createMemoryBookRepository } from "@/features/catalog/server/repository.memory";
import type { Book, CreateBookInput } from "@/features/catalog/schema";
import { createMemoryLoanRepository } from "@/features/loans/server/repository.memory";

/** Patrón Factory/Builder para datos de prueba: valores válidos por defecto, se sobreescribe lo que importa. */
let seq = 0;
export const aBook = (over: Partial<CreateBookInput> = {}): CreateBookInput => ({
  isbn: String(9780000000000 + ++seq),
  title: `Libro ${seq}`,
  author: "Autora Prueba",
  copies: 1,
  ...over,
});
/** Entrada válida de registro (F3): rol EXTERNO, el único por defecto. */
export const aMember = (over: Partial<CreateMemberInput> = {}): CreateMemberInput => ({
  name: `Persona ${++seq}`,
  email: `persona${seq}@example.com`,
  password: "clave-segura-123",
  role: "EXTERNO",
  ...over,
});
/** Entrada válida de alta con cualquier rol (`provision`): por defecto ESTUDIANTE. */
export const aProvisionedMember = (over: Partial<ProvisionMemberInput> = {}): ProvisionMemberInput => ({
  name: `Persona ${++seq}`,
  email: `persona${seq}@example.com`,
  password: "clave-segura-123",
  role: "ESTUDIANTE",
  ...over,
});

/** Arma servicios sobre repositorios e identidad en memoria: cada prueba empieza con un mundo vacío, sin red. */
export function makeWorld() {
  const identity = createMemoryIdentityProvider();
  const repos = {
    books: createMemoryBookRepository(),
    members: createMemoryMemberRepository(),
    loans: createMemoryLoanRepository(),
  };
  return {
    repos,
    identity,
    books: createBookService({ books: repos.books, loans: repos.loans }),
    members: createMemberService({ members: repos.members, identity }),
    auth: createAuthService({ members: repos.members, identity }),
  };
}
export type World = ReturnType<typeof makeWorld>;
export type { Book };
