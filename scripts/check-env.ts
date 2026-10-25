/** Uso: `npm run check:env`. Carga el archivo de entorno de la raíz y valida las variables; imprime solo el estado, nunca los valores. */
import { EnvChecker } from "@/shared/server/env";

try {
  process.loadEnvFile(".env");
} catch {
  console.log(
    "No se pudo cargar el archivo de entorno de la raíz (¿existe?). Se validan las variables ya definidas en el sistema.",
  );
}

const checker = new EnvChecker(process.env);
console.log(checker.report());
if (checker.isValid()) {
  console.log("\nEntorno válido.");
} else {
  console.log("\nHay variables por corregir (arriba, marcadas con ✗).");
  process.exitCode = 1;
}
