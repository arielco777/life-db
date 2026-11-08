import { activeCategories, archivedCategories, useCategories } from './hooks';
import type { UUID } from '@/domain/types';

/** `'all'`, `'none'` (no category) or a category ID. */
export type CategoryFilterValue = 'all' | 'none' | UUID;

interface CategoryFilterProps {
  value: CategoryFilterValue;
  onChange(value: CategoryFilterValue): void;
  /** Category IDs of the records being listed; decides which archived categories to offer (CAT-5). */
  usedCategoryIds: readonly (UUID | undefined)[];
  id?: string;
}

/**
 * Filter by category (CAT-5): every active category, then — in a separate "Archived"
 * group — only the archived categories that a listed record still uses. Lists are small,
 * so the used set comes straight from the loaded records.
 */
export function CategoryFilter({ value, onChange, usedCategoryIds, id }: CategoryFilterProps) {
  const { data = [] } = useCategories();
  const used = new Set(usedCategoryIds);
  const archived = archivedCategories(data).filter((c) => used.has(c.id));
  return (
    <select
      id={id}
      aria-label={id ? undefined : 'Filter by category'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="all">All categories</option>
      {activeCategories(data).map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
      {used.has(undefined) && <option value="none">No category</option>}
      {archived.length > 0 && (
        <optgroup label="Archived">
          {archived.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

/** Applies a CategoryFilterValue to records with an optional categoryId. */
export const matchesCategory = (filter: CategoryFilterValue, categoryId: UUID | undefined) =>
  filter === 'all' || (filter === 'none' ? !categoryId : categoryId === filter);
