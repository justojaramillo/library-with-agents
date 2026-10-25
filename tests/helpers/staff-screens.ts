import type { Member } from "@/features/accounts/schema";
import { createStaffService } from "@/features/accounts/server/staff-service";
import type { Role, SessionUser } from "@/shared/schema";
import { attributeOf, textOf } from "./html";
import { aProvisionedMember, makeWorld, type World } from "./factories";

/** Fila pública de una cuenta (lo que reciben las pantallas), con valores válidos por defecto. */
let rowSeq = 0;
export function aRow(over: Partial<Member> = {}): Member {
  rowSeq += 1;
  return {
    id: `uid-fila-${rowSeq}`,
    name: `Persona ${rowSeq}`,
    email: `persona${rowSeq}@example.com`,
    role: "ESTUDIANTE",
    active: true,
    ...over,
  };
}

/** Un botón del HTML: su texto visible y su `aria-label`. */
export type ButtonInfo = { text: string; label: string | null; disabled: boolean };

/** Todos los botones de un fragmento, en orden del documento. */
export function buttonsOf(html: string): ButtonInfo[] {
  const found: ButtonInfo[] = [];
  for (const match of html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)) {
    const open = `<button${match[1]}>`;
    found.push({
      text: textOf(match[2]),
      label: attributeOf(open, "aria-label"),
      disabled: /\sdisabled(=|\s|>)/.test(open),
    });
  }
  return found;
}

/** Estado («Activa»/«Inactiva») que muestra una tarjeta y si lo acompaña un icono decorativo. */
export function stateOf(article: string): { text: string; hasIcon: boolean } | null {
  for (const paragraph of article.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)) {
    const text = textOf(paragraph[1]);
    if (text === "Activa" || text === "Inactiva") {
      return { text, hasIcon: /<svg\b[^>]*aria-hidden="true"/.test(paragraph[1]) };
    }
  }
  return null;
}

/** Una cuenta creada en el mundo en memoria, con su sesión de prueba. */
export type Account = Member & { actor: SessionUser };

/**
 * Mundo de F13–F14 para las pantallas: repositorios e identidad en memoria (los de `makeWorld`) y el servicio de
 * personal real, que la página `/personal` consulta a través del contenedor.
 */
export function makeAccountsWorld(world: World = makeWorld()) {
  const staff = createStaffService({ members: world.repos.members, provision: world.members.provision });

  /** Crea la cuenta (con identidad) con ese rol; `active: false` la deja desactivada. */
  async function addAccount(role: Role, options: { name?: string; active?: boolean } = {}): Promise<Account> {
    const input = aProvisionedMember({ role });
    if (options.name !== undefined) {
      input.name = options.name;
    }
    const created = await world.members.provision(input);
    if (options.active === false) {
      await world.repos.members.setActive(created.id, false);
    }
    return {
      id: created.id,
      name: created.name,
      email: created.email,
      role,
      active: options.active !== false,
      actor: { member_id: created.id, role },
    };
  }

  return { world, staff, addAccount };
}
export type AccountsWorld = ReturnType<typeof makeAccountsWorld>;
