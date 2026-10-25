/**
 * B5 · Rellena `search_keys` en las cuentas que ya existían. Uso: `npm run backfill:members -- --yes`.
 * Sin `--yes` solo informa cuántas cuentas cambiaría. Es idempotente y solo escribe `search_keys`
 * (no toca ningún otro campo). Necesita las credenciales de Firebase en el archivo de entorno de la raíz.
 */
import { z } from "zod";
import { buildSearchKeys } from "@/features/accounts/server/member-search";
import { COLLECTIONS } from "@/shared/server/collections";
import { getAdminDb } from "@/shared/server/firebase";
import { describeLoggedError } from "@/shared/server/security/error-log";

try {
  process.loadEnvFile(".env");
} catch {
  console.log("No se pudo cargar el archivo de entorno de la raíz (¿existe?). Se usan las variables ya definidas.");
}

/** Lo único que se lee de cada cuenta. */
const AccountFieldsSchema = z.object({
  name: z.string(),
  email: z.string(),
  search_keys: z.array(z.string()).optional(),
});

/** Máximo de escrituras por lote de Firestore (el tope es 500). */
const BATCH_SIZE = 400;

type Change = { id: string; keys: string[] };
type Db = ReturnType<typeof getAdminDb>;

/** `true` si las dos listas tienen las mismas claves, sin importar el orden. */
function sameKeys(current: string[] | undefined, wanted: string[]): boolean {
  if (current === undefined || current.length !== wanted.length) {
    return false;
  }
  const have = new Set(current);
  return wanted.every((key) => have.has(key));
}

/** Cuentas cuyo `search_keys` falta o no coincide con el que corresponde a su nombre y correo. */
async function findChanges(db: Db): Promise<{ total: number; changes: Change[] }> {
  const snapshot = await db.collection(COLLECTIONS.members).select("name", "email", "search_keys").get();
  const changes: Change[] = [];
  for (const doc of snapshot.docs) {
    const fields = AccountFieldsSchema.parse(doc.data());
    const keys = buildSearchKeys(fields.name, fields.email);
    if (!sameKeys(fields.search_keys, keys)) {
      changes.push({ id: doc.id, keys });
    }
  }
  return { total: snapshot.size, changes };
}

/** Escribe solo `search_keys`, en lotes. */
async function applyChanges(db: Db, changes: Change[]): Promise<void> {
  const members = db.collection(COLLECTIONS.members);
  for (let start = 0; start < changes.length; start += BATCH_SIZE) {
    const batch = db.batch();
    for (const change of changes.slice(start, start + BATCH_SIZE)) {
      batch.update(members.doc(change.id), { search_keys: change.keys });
    }
    await batch.commit();
  }
}

/** Segundos de espera antes de escribir, para poder cancelar. */
const CANCEL_SECONDS = 5;

const LimitSchema = z.coerce.number().int().positive();

/** Valor de `--limit=N` (tope de cuentas por ejecución) o `undefined` si no se pasó. */
function readLimit(): number | undefined {
  const arg = process.argv.find((item) => item.startsWith("--limit="));
  if (arg === undefined) {
    return undefined;
  }
  return LimitSchema.parse(arg.slice("--limit=".length));
}

/** Avisa de dónde se va a escribir y espera unos segundos por si la persona quiere cancelar. */
async function warnAndWait(count: number): Promise<void> {
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  if (emulator !== undefined) {
    console.log(`AVISO: FIRESTORE_EMULATOR_HOST=${emulator}. Se escribirá en el EMULADOR.`);
  } else {
    console.log("AVISO: FIRESTORE_EMULATOR_HOST no está definido. Se escribirá en el Firestore real del proyecto.");
  }
  console.log(`Se actualizarán ${count} cuentas en ${CANCEL_SECONDS} segundos. Ctrl+C para cancelar.`);
  await new Promise((resolve) => setTimeout(resolve, CANCEL_SECONDS * 1000));
}

async function main(): Promise<void> {
  const db = getAdminDb();
  const { total, changes } = await findChanges(db);
  const project = process.env.FIREBASE_PROJECT_ID ?? "(sin definir)";
  console.log(`Proyecto "${project}": ${total} cuentas, ${changes.length} por actualizar.`);
  if (!process.argv.includes("--yes")) {
    console.log("No se ha escrito nada. Para confirmar, ejecútalo con --yes:  npm run backfill:members -- --yes");
    await db.terminate();
    return;
  }
  const limit = readLimit() ?? changes.length;
  const batchToApply = changes.slice(0, limit);
  await warnAndWait(batchToApply.length);
  await applyChanges(db, batchToApply);
  const remaining = changes.length - batchToApply.length;
  console.log(
    `Listo: ${batchToApply.length} cuentas actualizadas (solo search_keys). Quedan ${remaining} por actualizar.`,
  );
  await db.terminate();
}

main().catch((error) => {
  console.error("El rellenado falló:", describeLoggedError(error));
  process.exitCode = 1;
});
