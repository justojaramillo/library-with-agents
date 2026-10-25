import "server-only";
import { createAuthService } from "@/features/accounts/server/auth-service";
import { createFirebaseIdentityProvider } from "@/features/accounts/server/identity.firebase";
import { createMemberService } from "@/features/accounts/server/member-service";
import { createFirestoreMemberRepository } from "@/features/accounts/server/repository.firestore";
import { createBookService } from "@/features/catalog/server/book-service";
import { createFirestoreBookRepository } from "@/features/catalog/server/repository.firestore";
import { createDailyFineStrategy } from "@/features/loans/server/fine-strategy";
import { createLoanService } from "@/features/loans/server/loan-service";
import { createFirestoreLoanRepository } from "@/features/loans/server/repository.firestore";
import { getAdminAuth, getAdminDb } from "@/shared/server/firebase";

/**
 * Raíz de composición: aquí (y solo aquí) se conectan las features entre sí y con Firebase (ADR-0003).
 * Cada servicio recibe sus dependencias por parámetro; los puertos que una feature necesita de otra
 * (`ActiveLoansReader`, `BookLookup`, `MemberLookup`) se cumplen por estructura con los repositorios.
 */
function build() {
  const db = getAdminDb();
  const identity = createFirebaseIdentityProvider(getAdminAuth());
  const bookRepository = createFirestoreBookRepository(db);
  const memberRepository = createFirestoreMemberRepository(db);
  const loanRepository = createFirestoreLoanRepository(db);
  const memberService = createMemberService({ members: memberRepository, identity });
  return {
    books: createBookService({ books: bookRepository, loans: loanRepository }),
    // Solo lo seguro para rutas HTTP: se copian los métodos uno a uno para que `provision` no sea alcanzable.
    members: { register: memberService.register, get: memberService.get, list: memberService.list },
    // Alta con cualquier rol: solo para el seed y F13 (administración); ninguna ruta debe usarlo.
    admin: { provision: memberService.provision },
    auth: createAuthService({ members: memberRepository, identity }),
    // Se crea de forma perezosa: mientras F5/F7 no estén implementadas, el resto de la app funciona.
    loans: () =>
      createLoanService({
        books: bookRepository,
        members: memberRepository,
        loans: loanRepository,
        fine: createDailyFineStrategy(),
      }),
  };
}

declare global {
  // Sobrevive a la recarga en caliente de desarrollo: se guarda en `globalThis`.
  var libraryContainer: ReturnType<typeof build> | undefined;
}

export const getContainer = () => (globalThis.libraryContainer ??= build());
