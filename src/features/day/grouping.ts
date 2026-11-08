import type { Category, Habit } from '@/domain/types';

export interface HabitGroup {
  /** Undefined for habits without a category. */
  category?: Category;
  habits: Habit[];
}

/**
 * Groups habits by category for the daily view (DAY-4): groups follow the category order
 * from Settings → Categories (archived ones included, since old records keep them), habits
 * keep their own order inside each group, and uncategorized habits come last.
 */
export function groupByCategory(habits: readonly Habit[], categories: readonly Category[]): HabitGroup[] {
  const byId = new Map(categories.map((c, i) => [c.id, { category: c, index: i }]));
  const groups = new Map<string, HabitGroup & { index: number }>();
  for (const h of habits) {
    const known = h.categoryId ? byId.get(h.categoryId) : undefined;
    const key = known ? known.category.id : '';
    let g = groups.get(key);
    if (!g) {
      g = { category: known?.category, habits: [], index: known ? known.index : Infinity };
      groups.set(key, g);
    }
    g.habits.push(h);
  }
  return [...groups.values()]
    .sort((a, b) => a.index - b.index)
    .map(({ category, habits }) => ({ category, habits }));
}
