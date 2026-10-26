// El orden importa, no lo reordenes: fija Zod sin compilación antes de cargar esquemas (CSP).
import "@/shared/ui/client-setup";
import { readApiErrorMessage } from "@/features/catalog/ui/request-error";
import { DigitalInfoSchema, type DigitalInfo, type SetDigitalCopiesInput, type UploadContentInput } from "../schema";
import { DIGITAL_DEFAULT_ERROR, DigitalRequestError } from "./digital-state";

function digitalUrl(bookId: string, tail: string): string {
  return `/api/books/${encodeURIComponent(bookId)}/digital${tail}`;
}

/** Valida la respuesta con el contrato en el mismo punto de lectura. Si falla, lanza `DigitalRequestError`. */
async function readInfo(res: Response): Promise<DigitalInfo> {
  if (!res.ok) {
    throw new DigitalRequestError(res.status, await readApiErrorMessage(res, DIGITAL_DEFAULT_ERROR));
  }
  const parsed = DigitalInfoSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new DigitalRequestError(res.status, DIGITAL_DEFAULT_ERROR);
  }
  return parsed.data;
}

/** `GET /api/books/:id/digital`. Un fallo de red sube tal cual. */
export async function fetchDigitalInfo(bookId: string): Promise<DigitalInfo> {
  return readInfo(await fetch(digitalUrl(bookId, "")));
}

/** `PATCH /api/books/:id/digital/copies`. */
export async function saveDigitalCopies(bookId: string, input: SetDigitalCopiesInput): Promise<DigitalInfo> {
  return readInfo(
    await fetch(digitalUrl(bookId, "/copies"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

/** `PUT /api/books/:id/digital/content`. */
export async function uploadDigitalContent(bookId: string, input: UploadContentInput): Promise<DigitalInfo> {
  return readInfo(
    await fetch(digitalUrl(bookId, "/content"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}
