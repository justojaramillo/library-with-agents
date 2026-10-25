/**
 * Datos de ejemplo en Firebase. Uso: `npm run seed -- --yes` (sin `--yes` no escribe nada).
 * NO es destructivo: no borra nada; lo que ya existe (ConflictError) se salta con un aviso.
 * Crea las cuentas en Firebase Authentication y Firestore, y los libros de ejemplo (sin contenido digital).
 * Cada cuenta nueva recibe una contraseña aleatoria que se imprime UNA sola vez al final; no hay contraseñas fijas.
 * Necesita las credenciales de Firebase en el archivo de entorno de la raíz.
 */
import { randomBytes } from "node:crypto";
import { createFirebaseIdentityProvider } from "@/features/accounts/server/identity.firebase";
import { createMemberService, type MemberAdminService } from "@/features/accounts/server/member-service";
import { createFirestoreMemberRepository } from "@/features/accounts/server/repository.firestore";
import { createBookService } from "@/features/catalog/server/book-service";
import { createFirestoreBookRepository } from "@/features/catalog/server/repository.firestore";
import { createFirestoreLoanRepository } from "@/features/loans/server/repository.firestore";
import type { ProvisionMemberInput } from "@/features/accounts/schema";
import { ConflictError } from "@/shared/server/errors";
import { getAdminAuth, getAdminDb } from "@/shared/server/firebase";
import { describeLoggedError } from "@/shared/server/security/error-log";

try {
  process.loadEnvFile(".env");
} catch {
  console.log("No se pudo cargar el archivo de entorno de la raíz (¿existe?). Se usan las variables ya definidas.");
}

// Cuentas de demostración (sin contraseña: se genera una aleatoria por cuenta). `provision` admite cualquier rol.
const ACCOUNTS: Omit<ProvisionMemberInput, "password">[] = [
  { name: "Ada Administradora", email: "admin@example.com", role: "ADMINISTRADOR" },
  { name: "Beatriz Bibliotecaria", email: "bibliotecaria@example.com", role: "BIBLIOTECARIO" },
  { name: "Diego Docente", email: "docente@example.com", role: "DOCENTE" },
  { name: "Samuel Estudiante", email: "samuel@example.com", role: "ESTUDIANTE" },
  { name: "Sara Externa", email: "sara@example.com", role: "EXTERNO" },
];

const CATALOG: [string, string, string, number][] = [
  ["9780307474728", "Cien años de soledad", "Gabriel García Márquez", 2],
  ["9780060883287", "El amor en los tiempos del cólera", "Gabriel García Márquez", 1],
  ["9788437604947", "Rayuela", "Julio Cortázar", 1],
  ["9780141182803", "Ficciones", "Jorge Luis Borges", 3],
  ["9780140449136", "Crimen y castigo", "Fiódor Dostoievski", 1],
];

/** Ejecuta un alta; si ya existe (ConflictError) avisa y sigue. Devuelve `true` si creó algo. */
async function createOrSkip<T>(label: string, create: () => Promise<T>): Promise<boolean> {
  try {
    await create();
    return true;
  } catch (error) {
    if (error instanceof ConflictError) {
      console.log(`  · ya existe, se salta: ${label} (${error.message})`);
      return false;
    }
    throw error;
  }
}

/** Contraseña aleatoria de 24 caracteres (144 bits). */
const generatePassword = (): string => randomBytes(18).toString("base64url");

/** Sin `--yes` no se escribe nada: se dice qué proyecto se usaría y cómo confirmar. */
function printConfirmationHelp(): void {
  console.log(`El seed escribiría en el proyecto de Firebase "${process.env.FIREBASE_PROJECT_ID ?? "(sin definir)"}".`);
  console.log("No se ha escrito nada. Para confirmar, ejecútalo con --yes:  npm run seed -- --yes");
}

/** Crea las cuentas y devuelve `correo → contraseña` solo de las que se crearon en esta ejecución. */
async function seedAccounts(admin: MemberAdminService): Promise<Map<string, string>> {
  const credentials = new Map<string, string>();
  for (const account of ACCOUNTS) {
    const password = generatePassword();
    if (await createOrSkip(account.email, () => admin.provision({ ...account, password }))) {
      credentials.set(account.email, password);
    }
  }
  return credentials;
}

/** Imprime una sola vez la tabla de contraseñas de las cuentas nuevas y avisa de las que ya existían. */
function printCredentials(credentials: Map<string, string>): void {
  if (credentials.size > 0) {
    console.log("\nContraseñas de las cuentas creadas (se muestran solo ahora; guárdalas):");
    for (const [email, password] of credentials) {
      console.log(`  ${email} → ${password}`);
    }
  }
  if (credentials.size < ACCOUNTS.length) {
    console.log("\nLas cuentas que ya existían se omitieron: su contraseña no cambia.");
  }
}

async function main(): Promise<void> {
  if (!process.argv.includes("--yes")) {
    printConfirmationHelp();
    return;
  }
  const db = getAdminDb();
  const admin: MemberAdminService = createMemberService({
    members: createFirestoreMemberRepository(db),
    identity: createFirebaseIdentityProvider(getAdminAuth()),
  });
  const books = createBookService({
    books: createFirestoreBookRepository(db),
    loans: createFirestoreLoanRepository(db),
  });

  const credentials = await seedAccounts(admin);
  let createdBooks = 0;
  for (const [isbn, title, author, copies] of CATALOG) {
    if (await createOrSkip(`ISBN ${isbn}`, () => books.create({ isbn, title, author, copies }))) {
      createdBooks += 1;
    }
  }
  console.log(`Listo: ${credentials.size} cuentas y ${createdBooks} libros nuevos (sin borrar nada).`);
  printCredentials(credentials);
  await db.terminate();
}

main().catch((error) => {
  console.error("El seed falló:", describeLoggedError(error));
  process.exitCode = 1;
});
