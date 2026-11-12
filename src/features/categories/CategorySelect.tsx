import { activeCategories, useCategories } from './hooks';
import type { UUID } from '@/domain/types';

interface CategorySelectProps {
  value?: UUID;
  onChange(id: UUID | undefined): void;
  id?: string;
  /** Accessible name when there is no visible <label htmlFor>. */
  'aria-label'?: string;
  disabled?: boolean;
}

/**
 * Picks at most one category (CAT-3). Archived categories are not offered (CAT-2), except
 * the record's current one, which stays selectable so editing a record doesn't drop it.
 */
export function CategorySelect({ value, onChange, id, disabled, ...rest }: CategorySelectProps) {
  const { data = [], isPending } = useCategories();
  const current = value ? data.find((c) => c.id === value) : undefined;
  const options = activeCategories(data);
  const showCurrentArchived = current?.archivedAt;

  return (
    <select
      id={id}
      aria-label={rest['aria-label']}
      disabled={disabled || isPending}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">No category</option>
      {options.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
      {showCurrentArchived && <option value={current.id}>{current.name} (archived)</option>}
    </select>
  );
}
