/**
 * S1 (reglas 8 y 11) · Decisión pura de qué identidades huérfanas de Authentication se pueden borrar.
 * No lee ni escribe nada: recibe datos y `now`, y devuelve la decisión (la usa `scripts/reconcile-identities.ts`).
 */

/** Una identidad de Authentication sin documento en `members`. `created` es `metadata.creationTime`. */
export type OrphanIdentity = { uid: string; created: string };

export type SkippedIdentity = { uid: string; reason: string };

export type DeletionPlanInput<T extends OrphanIdentity> = {
  /** Valor de `FIREBASE_PROJECT_ID`. */
  projectId: string | undefined;
  /** Valor de `--project=<id>`. */
  projectFlag: string | undefined;
  /** Total de identidades en Authentication (huérfanas o no). */
  total: number;
  orphans: T[];
  forceMany: boolean;
  now: Date;
};

export type DeletionPlan<T extends OrphanIdentity> = {
  /** Motivos por los que NO se borra nada. Si hay alguno, `deletable` queda vacío. */
  refusals: string[];
  deletable: T[];
  skipped: SkippedIdentity[];
};

/** Una identidad creada hace menos de esto puede ser un registro en curso: no se borra. */
export const MIN_ORPHAN_AGE_MS = 10 * 60 * 1000;

/** Motivo de aborto si solo uno de los dos emuladores está definido; `null` si la combinación es coherente. */
export function checkEmulatorHosts(authHost: string | undefined, firestoreHost: string | undefined): string | null {
  const authDefined = authHost !== undefined && authHost !== "";
  const firestoreDefined = firestoreHost !== undefined && firestoreHost !== "";
  if (authDefined && !firestoreDefined) {
    return "FIREBASE_AUTH_EMULATOR_HOST está definido pero FIRESTORE_EMULATOR_HOST no: Authentication sería el emulador y Firestore el real.";
  }
  if (!authDefined && firestoreDefined) {
    return "FIRESTORE_EMULATOR_HOST está definido pero FIREBASE_AUTH_EMULATOR_HOST no: Firestore sería el emulador y Authentication el real.";
  }
  return null;
}

/** Motivo para saltar la identidad por su fecha de creación; `null` si es lo bastante antigua. */
function youngReason(created: string, now: Date): string | null {
  const createdMs = new Date(created).getTime();
  if (Number.isNaN(createdMs)) {
    return "fecha de creación ilegible";
  }
  if (now.getTime() - createdMs < MIN_ORPHAN_AGE_MS) {
    return "creada hace menos de 10 minutos";
  }
  return null;
}

/**
 * Justo antes de cada `deleteUser`: salta la identidad si ya tiene documento `members/{uid}`
 * o si se creó hace menos de 10 minutos. `null` significa que se puede borrar.
 */
export function recheckBeforeDelete(orphan: OrphanIdentity, memberExists: boolean, now: Date): string | null {
  if (memberExists) {
    return "ya tiene documento en members";
  }
  return youngReason(orphan.created, now);
}

/** Motivos de rechazo globales (proyecto y proporción de huérfanas). */
function globalRefusals(input: {
  projectId: string | undefined;
  projectFlag: string | undefined;
  total: number;
  count: number;
  forceMany: boolean;
}): string[] {
  const refusals: string[] = [];
  if (input.projectId === undefined || input.projectId === "") {
    refusals.push("FIREBASE_PROJECT_ID no está definido.");
  } else if (input.projectFlag === undefined) {
    refusals.push(`Falta --project=${input.projectId} para confirmar el proyecto.`);
  } else if (input.projectFlag !== input.projectId) {
    refusals.push(`--project=${input.projectFlag} no coincide con FIREBASE_PROJECT_ID (${input.projectId}).`);
  }
  if (input.total > 0 && input.count * 2 >= input.total && !input.forceMany) {
    refusals.push(
      `Las huérfanas (${input.count}) son la mitad o más de las ${input.total} identidades: parece un error de configuración. Usa --force-many si es correcto.`,
    );
  }
  return refusals;
}

/**
 * Qué identidades se pueden borrar y por qué se rechaza. Rechazo global (proyecto distinto o ausente,
 * huérfanas ≥ 50 % del total sin `forceMany`) → nada se borra. Además se saltan, una a una, las creadas hace
 * menos de 10 minutos o con fecha ilegible.
 */
export function planDeletion<T extends OrphanIdentity>(input: DeletionPlanInput<T>): DeletionPlan<T> {
  const refusals = globalRefusals({
    projectId: input.projectId,
    projectFlag: input.projectFlag,
    total: input.total,
    count: input.orphans.length,
    forceMany: input.forceMany,
  });
  if (refusals.length > 0) {
    return { refusals, deletable: [], skipped: [] };
  }
  const deletable: T[] = [];
  const skipped: SkippedIdentity[] = [];
  for (const orphan of input.orphans) {
    const reason = youngReason(orphan.created, input.now);
    if (reason === null) {
      deletable.push(orphan);
    } else {
      skipped.push({ uid: orphan.uid, reason });
    }
  }
  return { refusals, deletable, skipped };
}
