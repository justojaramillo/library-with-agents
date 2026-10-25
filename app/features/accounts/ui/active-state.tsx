import type { Member } from "../schema";
import { ActiveToggle } from "./active-toggle";
import { type ActiveActor, canShowToggle, describeActiveState } from "./active-rules";

const ICON_CLASS = "mt-1 size-4 shrink-0";

/** Estado de la cuenta: icono y texto, nunca solo color. */
export function ActiveState({ active }: { active: boolean }) {
  if (active) {
    return (
      <p className="flex items-start gap-2 font-medium text-success">
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className={ICON_CLASS}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M3 8.5l3.5 3.5L13 4.5" />
        </svg>
        {describeActiveState(true)}
      </p>
    );
  }
  return (
    <p className="flex items-start gap-2 font-medium text-warning">
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className={ICON_CLASS}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M8 2a6 6 0 100 12A6 6 0 008 2zM4 12L12 4" />
      </svg>
      {describeActiveState(false)}
    </p>
  );
}

/** El botón de estado solo se dibuja si hay actor y la matriz de la regla 7 lo permite. */
export function ToggleSlot({
  member,
  actor,
}: {
  member: Pick<Member, "id" | "name" | "role" | "active">;
  actor?: ActiveActor;
}) {
  if (actor === undefined) {
    return null;
  }
  if (!canShowToggle(actor.role, actor.id, member)) {
    return null;
  }
  return <ActiveToggle memberId={member.id} memberName={member.name} active={member.active} />;
}
