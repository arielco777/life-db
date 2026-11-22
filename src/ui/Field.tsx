import type { ReactNode } from 'react';

/** A labelled form field with an optional hint and error message. */
export function Field({
  label,
  id,
  hint,
  error,
  children,
}: {
  label: string;
  id: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {hint && <span className="small muted"> · {hint}</span>}
      </label>
      {children}
      {error && <p className="field-msg error">{error}</p>}
    </div>
  );
}
