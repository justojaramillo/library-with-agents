import type { DigitalService } from "@/features/reader/server/digital-service";
import type { Role } from "@/shared/schema";
import { makeDigitalWorld, type DigitalWorld } from "./digital";

/** Estado compartido de las pruebas de rutas de F27: el mundo en memoria y quién tiene la sesión. */
export type RouteHolder = {
  world: DigitalWorld;
  /** Servicio que atiende las rutas; por defecto el del mundo (una prueba puede poner otro que falle). */
  service: DigitalService;
  /** Cuenta con sesión, o `null` para un visitante. */
  uid: string | null;
  role: Role;
};

function freshWorld(): DigitalWorld {
  const world = makeDigitalWorld();
  world.books.addBook({ id: "libro-1", title: "Rayuela", digital_copies: 2 });
  return world;
}

const initial = freshWorld();
export const routeHolder: RouteHolder = { world: initial, service: initial.service, uid: null, role: "BIBLIOTECARIO" };

export function resetRouteHolder(): void {
  const world = freshWorld();
  routeHolder.world = world;
  routeHolder.service = world.service;
  routeHolder.uid = null;
  routeHolder.role = "BIBLIOTECARIO";
}

/** Inicia sesión como una cuenta activa con ese rol. */
export function signInAs(role: Role, uid = "staff-1"): void {
  routeHolder.uid = uid;
  routeHolder.role = role;
}

export function signOut(): void {
  routeHolder.uid = null;
}

/** Sustituto de `next/headers`: hay cookie solo si alguien inició sesión. */
export const headersMock = {
  cookies: async () => ({
    get: () => {
      if (routeHolder.uid === null) {
        return undefined;
      }
      return { value: "cookie-valida" };
    },
  }),
};

/** Sustituto de Firebase Admin: la cookie vale para `routeHolder.uid` y el rol sale de la cuenta guardada. */
export const firebaseMock = {
  getAdminAuth: () => ({
    verifySessionCookie: async () => ({ uid: routeHolder.uid }),
  }),
  getAdminDb: () => ({
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: true, data: () => ({ role: routeHolder.role, active: true }) }),
      }),
    }),
  }),
};

/** Sustituto del contenedor: solo el servicio digital. */
export const containerMock = {
  getContainer: () => ({ digital: routeHolder.service }),
};
