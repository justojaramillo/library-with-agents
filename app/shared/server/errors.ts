/** Errores de dominio. Las rutas (HTTP) los traducen a códigos de estado en un solo lugar. */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
/** 404 */
export class NotFoundError extends DomainError {}
/** 409: la operación choca con el estado actual (duplicado, sin ejemplares, límite). */
export class ConflictError extends DomainError {}
/** 401: no hay sesión válida o las credenciales son incorrectas. */
export class UnauthorizedError extends DomainError {}
/** 403: hay sesión, pero no tiene permiso sobre ese recurso. */
export class ForbiddenError extends DomainError {}
