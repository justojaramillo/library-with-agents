import type { Member } from "../schema";
import { ROLE_LABELS } from "./role-labels";

function AccountItem({ member }: { member: Pick<Member, "name" | "email" | "role"> }) {
  return (
    <li>
      <article className="h-full rounded border border-line bg-surface p-4">
        <h2 className="text-lg font-semibold">{member.name}</h2>
        <dl className="text-ink-muted">
          <dt className="inline">Correo: </dt>
          <dd className="inline break-words">{member.email}</dd>
          <br />
          <dt className="inline">Rol: </dt>
          <dd className="inline">{ROLE_LABELS[member.role]}</dd>
        </dl>
      </article>
    </li>
  );
}

/** Lista de cuentas: 1 columna a 360 px, 2 desde 768 px y 3 desde 1024 px. */
export function AccountList({ members }: { members: Member[] }) {
  return (
    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {members.map((member) => (
        <AccountItem key={member.id} member={member} />
      ))}
    </ul>
  );
}
