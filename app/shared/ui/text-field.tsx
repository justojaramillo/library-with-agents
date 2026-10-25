const INPUT_CLASS = "min-h-11 w-full rounded border border-control-border bg-surface px-3 text-ink";

export interface TextFieldProps {
  id: string;
  name: string;
  label: string;
  type: "text" | "email" | "password";
  autoComplete: string;
  /** Texto de ayuda visible bajo el campo (queda enlazado con `aria-describedby`). */
  hint?: string;
  /** Error del campo: va en `role="alert"` y se enlaza con `aria-describedby`. */
  error?: string;
  inputMode?: "numeric";
  defaultValue?: string;
}

/** Ids de la ayuda y del error que describen el campo, en ese orden; `undefined` si no hay ninguno. */
function describedByIds(id: string, hint: string | undefined, error: string | undefined): string | undefined {
  const ids: string[] = [];
  if (hint !== undefined) {
    ids.push(`${id}-ayuda`);
  }
  if (error !== undefined) {
    ids.push(`${id}-error`);
  }
  if (ids.length === 0) {
    return undefined;
  }
  return ids.join(" ");
}

/** Error de un campo: nada si no hay. */
function FieldError({ id, error }: { id: string; error: string | undefined }) {
  if (error === undefined) {
    return null;
  }
  return (
    <p id={`${id}-error`} role="alert" className="text-sm font-medium text-danger">
      {error}
    </p>
  );
}

/** Ayuda de un campo: nada si no hay. */
function FieldHint({ id, hint }: { id: string; hint: string | undefined }) {
  if (hint === undefined) {
    return null;
  }
  return (
    <p id={`${id}-ayuda`} className="text-sm text-ink-muted">
      {hint}
    </p>
  );
}

/** Campo de texto no controlado: etiqueta visible, ayuda y error enlazados. */
export function TextField(props: TextFieldProps) {
  const { id, name, label, type, autoComplete, hint, error, inputMode, defaultValue } = props;
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        required
        autoComplete={autoComplete}
        inputMode={inputMode}
        defaultValue={defaultValue}
        aria-invalid={error !== undefined}
        aria-describedby={describedByIds(id, hint, error)}
        className={INPUT_CLASS}
      />
      <FieldHint id={id} hint={hint} />
      <FieldError id={id} error={error} />
    </div>
  );
}
