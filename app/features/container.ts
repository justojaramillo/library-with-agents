import "server-only";
import { revalidateTag } from "next/cache";
import { createAuthService } from "@/features/accounts/server/auth-service";
import { createFirebaseIdentityProvider } from "@/features/accounts/server/identity.firebase";
import { createMemberService } from "@/features/accounts/server/member-service";
import { createFirestoreMemberRepository } from "@/features/accounts/server/repository.firestore";
import { createFirestoreTeacherRequestRepository } from "@/features/accounts/server/teacher-request-repository.firestore";
import { createStaffService } from "@/features/accounts/server/staff-service";
import { createTeacherRequestService } from "@/features/accounts/server/teacher-request-service";
import { BOOKS_CACHE_TAG, registerBookSearch, searchBooksCached } from "@/features/catalog/server/book-search-cache";
import { normalizeBookText } from "@/features/catalog/server/book-search";
import { createBookService } from "@/features/catalog/server/book-service";
import { createFirestoreBookRepository } from "@/features/catalog/server/repository.firestore";
import { createDailyFineStrategy } from "@/features/loans/server/fine-strategy";
import { createLoanService } from "@/features/loans/server/loan-service";
import { createFirestoreLoanRepository } from "@/features/loans/server/repository.firestore";
import { createBlobContentStore } from "@/features/reader/server/content-store.blob";
import { createFirestoreDigitalBookRepository } from "@/features/reader/server/digital-repository.firestore";
import { createDigitalService } from "@/features/reader/server/digital-service";
import { getAdminAuth, getAdminDb } from "@/shared/server/firebase";
import { describeAuthError } from "@/shared/server/security/firebase-errors";

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
  const staffService = createStaffService({ members: memberRepository, provision: memberService.provision });
  const bookService = createBookService({ books: bookRepository, loans: loanRepository });
  // La función cacheada llama al servicio real a través de este registro (ADR-0008).
  registerBookSearch(bookService.search);
  return {
    books: {
      create: bookService.create,
      // Solo la búsqueda se cachea (60 s, etiqueta `books`); lecturas por lote y altas no.
      search: (q: string, limit?: number) => searchBooksCached(...normalizeBookSearch(q, limit)),
      getMany: bookService.getMany,
      getSummaries: bookService.getSummaries,
    },
    // Defensa en profundidad (S1): `search`, `getMany` y `list` no comprueban al actor; toda ruta o página que los
    // use debe exigir personal (`requireStaff`) antes de llamarlos.
    // Solo lo seguro para rutas HTTP: se copian los métodos uno a uno para que `provision` no sea alcanzable.
    members: {
      register: memberService.register,
      get: memberService.get,
      list: memberService.list,
      search: memberService.search,
      getMany: memberService.getMany,
    },
    // Alta con cualquier rol: solo para el seed y F13 (administración); ninguna ruta debe usarlo.
    admin: { provision: memberService.provision },
    // F13–F14 · Bibliotecarios y activar/desactivar cuentas (el servicio comprueba al actor). Se copian uno a uno
    // para que `provision` siga sin ser alcanzable desde las rutas.
    staff: { create: staffService.create, list: staffService.list, setActive: staffService.setActive },
    auth: createAuthService({ members: memberRepository, identity }),
    // F11–F12 · Solicitud del rol de docente (el servicio comprueba el rol del actor; las rutas solo exigen sesión).
    teacherRequests: createTeacherRequestService({
      requests: createFirestoreTeacherRequestRepository(db),
      members: memberRepository,
      identity,
    }),
    // F27 · Contenido digital y copias digitales (el servicio comprueba al actor). El contador de préstamos digitales
    // activos vale 0 hasta F38, que lo cambia por el real.
    digital: createDigitalService({
      books: createFirestoreDigitalBookRepository(db),
      store: createBlobContentStore(),
      activeLoans: { countActiveDigitalByBook: async () => 0 },
    }),
    loans: createLoanService({
      books: bookRepository,
      members: memberRepository,
      loans: loanRepository,
      fine: createDailyFineStrategy(),
    }),
  };
}

type Container = ReturnType<typeof build>;

interface VersionedContainer {
  version: number;
  container: Container;
}

declare global {
  // Sobrevive a la recarga en caliente de desarrollo: se guarda en `globalThis` junto a la versión del módulo con la
  // que se construyó. Cada evaluación del módulo sube `libraryContainerVersion`; si cambia el código de un servicio,
  // la versión guardada ya no coincide y `getContainer` reconstruye el contenedor. En producción el módulo se evalúa
  // una sola vez y el contenedor se construye una sola vez.
  var libraryContainer: VersionedContainer | undefined;
  var libraryContainerVersion: number | undefined;
}

globalThis.libraryContainerVersion = (globalThis.libraryContainerVersion ?? 0) + 1;
const MODULE_VERSION = globalThis.libraryContainerVersion;

export function getContainer(): Container {
  const stored = globalThis.libraryContainer;
  if (stored && stored.version === MODULE_VERSION) {
    return stored.container;
  }
  const container = build();
  globalThis.libraryContainer = { version: MODULE_VERSION, container };
  return container;
}

/** Tope de `limit` de `SearchBooksQuerySchema`; un valor fuera de rango o no entero se normaliza a este rango. */
const MAX_SEARCH_LIMIT = 50;

/**
 * S1 regla 13 · Clave de caché canónica: `Dune`, `dune` y ` DUNE ` comparten entrada. `filterBooks` normaliza igual,
 * así que el resultado es el mismo que sin normalizar. `limit` queda `undefined` o un entero entre 1 y 50.
 */
function normalizeBookSearch(q: string, limit?: number): [string, number | undefined] {
  const text = normalizeBookText(q);
  if (limit === undefined || !Number.isFinite(limit)) {
    return [text, undefined];
  }
  return [text, Math.min(MAX_SEARCH_LIMIT, Math.max(1, Math.trunc(limit)))];
}

/**
 * Invalida la caché de búsqueda de libros (etiqueta `books`). Las rutas la llaman tras crear un libro,
 * prestar o devolver. `{ expire: 0 }`: no se sirve contenido viejo (fuera de una Server Action no hay `updateTag`).
 * S1 regla 14: nunca lanza. El préstamo, la devolución o el alta ya están guardados; un fallo aquí solo se registra
 * (nombre del error) y la caché se renueva sola al vencer los 60 s.
 */
export function invalidateBooksCache(): void {
  try {
    revalidateTag(BOOKS_CACHE_TAG, { expire: 0 });
  } catch (error) {
    console.error("No se pudo invalidar la caché del catálogo:", describeAuthError(error));
  }
}
