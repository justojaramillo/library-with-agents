"use client";

// El orden importa, no lo reordenes: fija Zod sin compilación antes de cargar esquemas (CSP).
import "@/shared/ui/client-setup";
import { z } from "zod";
import { MemberSchema, type Member } from "@/features/accounts/schema";
import { ROLE_LABELS } from "@/features/accounts/ui/role-labels";
import { SearchPicker, SUGGESTION_LIMIT } from "./search-picker";

const MembersSchema = z.array(MemberSchema);

function buildUrl(q: string): string {
  return `/api/members?q=${encodeURIComponent(q)}&limit=${SUGGESTION_LIMIT + 1}&lendable=true`;
}

function suggestionText(member: Member): string {
  return `${member.name} — ${member.email} — ${ROLE_LABELS[member.role]}`;
}

function describe(member: Member): string {
  return `${member.name} — ${member.email}`;
}

function getKey(member: Member): string {
  return member.id;
}

type MemberPickerProps = {
  onSelect: (member: Member) => void;
  selected: Member | null;
  onClear: () => void;
};

/** Buscador de personas a quienes prestar (solo cuentas activas de prestatarios; lo valida el servidor). */
export function MemberPicker({ onSelect, selected, onClear }: MemberPickerProps) {
  return (
    <SearchPicker
      label="Buscar persona (nombre o correo)"
      selectedLabel="Persona seleccionada"
      buildUrl={buildUrl}
      schema={MembersSchema}
      selected={selected}
      onSelect={onSelect}
      onClear={onClear}
      describe={describe}
      suggestionText={suggestionText}
      getKey={getKey}
    />
  );
}
