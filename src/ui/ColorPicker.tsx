import { useId, type CSSProperties } from 'react';

/**
 * Category colors. The first eight are the seeded defaults (0002_seed_categories.sql); all
 * are mid-tone so they read on both the paper and ink themes. Used sparingly (design §7).
 */
export const PALETTE: { color: string; name: string }[] = [
  { color: '#5f9e6e', name: 'Green' },
  { color: '#4f7cac', name: 'Blue' },
  { color: '#c49a3a', name: 'Ochre' },
  { color: '#8a6bb5', name: 'Violet' },
  { color: '#c46a7a', name: 'Rose' },
  { color: '#9a7b5f', name: 'Brown' },
  { color: '#5f8f9e', name: 'Teal' },
  { color: '#d17f4a', name: 'Orange' },
  { color: '#b5524a', name: 'Red' },
  { color: '#6e8a3f', name: 'Olive' },
  { color: '#5a6fb8', name: 'Indigo' },
  { color: '#8b8579', name: 'Grey' },
];

interface ColorPickerProps {
  value?: string;
  onChange(color: string): void;
  label: string;
}

/** A radio group of swatches; arrow keys move between them like any native radio group. */
export function ColorPicker({ value, onChange, label }: ColorPickerProps) {
  const name = useId();
  const options =
    value && !PALETTE.some((p) => p.color === value)
      ? [...PALETTE, { color: value, name: 'Custom' }]
      : PALETTE;
  return (
    <fieldset className="swatches">
      <legend className="sr-only">{label}</legend>
      {options.map((p) => (
        <label
          key={p.color}
          className="swatch"
          style={{ '--swatch': p.color } as CSSProperties}
          title={p.name}
        >
          <input
            type="radio"
            name={name}
            value={p.color}
            checked={value === p.color}
            onChange={() => onChange(p.color)}
            aria-label={p.name}
          />
        </label>
      ))}
    </fieldset>
  );
}
