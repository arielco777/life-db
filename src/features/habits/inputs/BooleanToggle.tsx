import type { ValueInputProps } from './types';

/**
 * Done / not done (HAB-2). A click toggles between done and not logged, the common case;
 * an explicit "not done" (0) is set from the entry menu and shows as ✗.
 */
export function BooleanToggle({ value, onChange, label, disabled }: ValueInputProps) {
  const state = value === 1 ? 'done' : value === 0 ? 'not-done' : 'empty';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={value === 1}
      aria-label={state === 'not-done' ? `${label} (marked not done)` : label}
      className={`check check-${state}`}
      disabled={disabled}
      onClick={() => onChange(value === 1 ? undefined : 1)}
    >
      <span aria-hidden>{state === 'done' ? '✓' : state === 'not-done' ? '✗' : ''}</span>
    </button>
  );
}
