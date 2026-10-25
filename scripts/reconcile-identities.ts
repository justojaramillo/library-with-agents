/**
 * S1 · Identidades huérfanas: cuentas de Firebase Authentication sin documento `members/{uid}`.
 * Uso: `npm run reconcile:identities` (solo informa) · `npm run reconcile:identities -- --yes --delete` (las borra).
 * Sin `--yes` no escribe nada. Nunca toca cuentas que tienen documento. Los correos salen enmascarados.
 * Para borrar exige además `--project=<id>` igual a FIREBASE_PROJECT_ID; se niega si las huérfanas son la mitad
 * o más de todas las identidades (salvo `--force-many`); aborta si solo uno de los dos emuladores está definido;
 * y relee `members/{uid}` antes de cada borrado (salta si existe o si se creó hace menos de 10 minutos).
 * Necesita las credenciales de Firebase en el archivo de entorno de la raíz.
 */
import { COLLECTIONS } from "@/shared/server/collections";
import { getAdminAuth, getAdminDb } from "@/shared/server/firebase";
import { checkEmulatorHosts, planDeletion, recheckBeforeDelete } from "@/shared/server/security/orphan-policy";

try {
  process.loadEnvFile(".env");
} catch {
  console.log("No se pudo cargar el archivo de entorno de la raíz (¿existe?). Se usan las variables ya definidas.");
}

/** Usuarios por página de `listUsers` (el máximo de Firebase es 1000). */
const PAGE_SIZE = 1000;
/** Segundos de espera antes de borrar, para poder cancelar. */
const CANCEL_SECONDS = 5;

type Orphan = { uid: string; email: string; provider: string; created: string };

/** Mensaje de un error sin pila ni propiedades extra. */
function messageOf<T>(error: T): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "error desconocido";
}

/** «ab***@dominio»: solo las dos primeras letras del usuario y el dominio. */
function maskEmail(email: string | undefined): string {
  if (email === undefined || !email.includes("@")) {
    return "(sin correo)";
  }
  const at = email.lastIndexOf("@");
  return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`;
}

/** Los uids de la lista que NO tienen documento en `members`, consultados por lotes con `getAll`. */
async function findMissing(uids: string[]): Promise<Set<string>> {
  const db = getAdminDb();
  const members = db.collection(COLLECTIONS.members);
  const snapshots = await db.getAll(...uids.map((uid) => members.doc(uid)), { fieldMask: [] });
  const missing = new Set<string>();
  for (const snapshot of snapshots) {
    if (!snapshot.exists) {
      missing.add(snapshot.id);
    }
  }
  return missing;
}

/** Recorre todas las cuentas de Authentication, página a página, y reúne las huérfanas. */
async function findOrphans(): Promise<{ total: number; orphans: Orphan[] }> {
  const auth = getAdminAuth();
  const orphans: Orphan[] = [];
  let total = 0;
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(PAGE_SIZE, pageToken);
    total += page.users.length;
    if (page.users.length > 0) {
      const missing = await findMissing(page.users.map((user) => user.uid));
      for (const user of page.users) {
        if (missing.has(user.uid)) {
          orphans.push({
            uid: user.uid,
            email: maskEmail(user.email),
            provider: user.providerData.at(0)?.providerId ?? "(sin proveedor)",
            created: user.metadata.creationTime,
          });
        }
      }
    }
    pageToken = page.pageToken;
  } while (pageToken !== undefined);
  return { total, orphans };
}

/** Valor de una opción `--nombre=valor` de la línea de comandos, o `undefined`. */
function optionValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  if (found === undefined) {
    return undefined;
  }
  return found.slice(prefix.length);
}

/** Imprime ambos emuladores y devuelve el motivo de aborto si la combinación es incoherente. */
function describeHosts(): string | null {
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
  console.log(`FIREBASE_AUTH_EMULATOR_HOST=${authHost ?? "(no definido: Authentication REAL)"}`);
  console.log(`FIRESTORE_EMULATOR_HOST=${firestoreHost ?? "(no definido: Firestore REAL)"}`);
  return checkEmulatorHosts(authHost, firestoreHost);
}

/** Espera unos segundos por si la persona quiere cancelar. */
async function warnAndWait(count: number): Promise<void> {
  console.log(`Se borrarán hasta ${count} identidades en ${CANCEL_SECONDS} segundos. Ctrl+C para cancelar.`);
  await new Promise((resolve) => setTimeout(resolve, CANCEL_SECONDS * 1000));
}

/** Borra las identidades de a una, releyendo `members/{uid}` antes de cada borrado; un fallo no detiene el resto. */
async function deleteOrphans(orphans: Orphan[]): Promise<number> {
  const auth = getAdminAuth();
  const members = getAdminDb().collection(COLLECTIONS.members);
  let deleted = 0;
  for (const orphan of orphans) {
    try {
      const snapshot = await members.doc(orphan.uid).get();
      const reason = recheckBeforeDelete(orphan, snapshot.exists, new Date());
      if (reason !== null) {
        console.log(`  Se salta ${orphan.uid}: ${reason}.`);
        continue;
      }
      await auth.deleteUser(orphan.uid);
      deleted += 1;
    } catch (error) {
      console.error(`No se pudo borrar ${orphan.uid}: ${messageOf(error)}`);
    }
  }
  return deleted;
}

async function main(): Promise<void> {
  const hostsProblem = describeHosts();
  if (hostsProblem !== null) {
    console.error(`ABORTADO: ${hostsProblem}`);
    process.exitCode = 1;
    return;
  }
  const project = process.env.FIREBASE_PROJECT_ID ?? "(sin definir)";
  const { total, orphans } = await findOrphans();
  console.log(`Proyecto "${project}": ${total} identidades en Authentication, ${orphans.length} sin cuenta.`);
  for (const orphan of orphans) {
    console.log(`  ${orphan.uid}  ${orphan.email}  ${orphan.provider}  creada ${orphan.created}`);
  }
  const confirmed = process.argv.includes("--yes") && process.argv.includes("--delete");
  if (!confirmed || orphans.length === 0) {
    console.log(
      `No se ha borrado nada. Para borrarlas: npm run reconcile:identities -- --yes --delete --project=${project}`,
    );
    await getAdminDb().terminate();
    return;
  }
  const plan = planDeletion({
    projectId: process.env.FIREBASE_PROJECT_ID,
    projectFlag: optionValue("project"),
    total,
    orphans,
    forceMany: process.argv.includes("--force-many"),
    now: new Date(),
  });
  for (const refusal of plan.refusals) {
    console.error(`NO SE BORRA: ${refusal}`);
  }
  for (const skipped of plan.skipped) {
    console.log(`  Se salta ${skipped.uid}: ${skipped.reason}.`);
  }
  if (plan.refusals.length > 0 || plan.deletable.length === 0) {
    console.log("No se ha borrado nada.");
    if (plan.refusals.length > 0) {
      process.exitCode = 1;
    }
    await getAdminDb().terminate();
    return;
  }
  await warnAndWait(plan.deletable.length);
  const deleted = await deleteOrphans(plan.deletable);
  console.log(`Listo: ${deleted} de ${plan.deletable.length} identidades borradas.`);
  await getAdminDb().terminate();
}

main().catch((error) => {
  console.error(`La conciliación falló: ${messageOf(error)}`);
  process.exitCode = 1;
});
