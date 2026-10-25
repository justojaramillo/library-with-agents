import type { Member } from "../schema";
import type { ActiveActor } from "./active-rules";
import { ActiveState, ToggleSlot } from "./active-state";
import { ActiveNotice, ActiveNoticeProvider } from "./active-toggle";
import { ROLE_LABELS } from "./role-labels";

export const EMPTY_STAFF_TEXT = "No hay personal registrado.";

function StaffItem({ member, actor }: { member: Member; actor: ActiveActor }) {
  return (
    <li className="min-w-0">
      <article className="grid h-full content-start gap-3 rounded border border-line bg-surface p-4">
        <h2 className="text-lg font-semibold break-words">{member.name}</h2>
        <dl className="text-ink-muted">
          <dt className="inline">Correo: </dt>
          <dd className="inline break-words">{member.email}</dd>
          <br />
          <dt className="inline">Rol: </dt>
          <dd className="inline">{ROLE_LABELS[member.role]}</dd>
        </dl>
        <ActiveState active={member.active} />
        <ToggleSlot member={member} actor={actor} />
      </article>
    </li>
  );
}

function StaffItems({ members, actor }: { members: Member[]; actor: ActiveActor }) {
  if (members.length === 0) {
    return <p className="text-ink-muted">{EMPTY_STAFF_TEXT}</p>;
  }
  return (
    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {members.map((member) => (
        <StaffItem key={member.id} member={member} actor={actor} />
      ))}
    </ul>
  );
}

/**
 * F13–F14 · Lista del personal (presentacional): una tarjeta por cuenta con nombre, correo, rol, estado y, para los
 * bibliotecarios, el botón de estado. 1 columna a 360 px, 2 desde 768 px y 3 desde 1024 px.
 */
export function StaffList({ members, actor }: { members: Member[]; actor: ActiveActor }) {
  return (
    <ActiveNoticeProvider>
      <ActiveNotice />
      <StaffItems members={members} actor={actor} />
    </ActiveNoticeProvider>
  );
}
