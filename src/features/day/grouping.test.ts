import { groupByCategory } from './grouping';
import type { Category, Habit } from '@/domain/types';

const cat = (id: string): Category => ({ id, name: id }) as Category;
const h = (name: string, categoryId?: string): Habit => ({ id: name, name, categoryId }) as Habit;

describe('groupByCategory (DAY-4)', () => {
  it('orders groups by category order, keeps habit order, puts uncategorized last', () => {
    const groups = groupByCategory(
      [h('a', 'work'), h('b'), h('c', 'health'), h('d', 'work'), h('e', 'deleted-cat')],
      [cat('health'), cat('work')],
    );
    expect(groups.map((g) => [g.category?.id, g.habits.map((x) => x.name)])).toEqual([
      ['health', ['c']],
      ['work', ['a', 'd']],
      [undefined, ['b', 'e']],
    ]);
  });
  it('handles no habits', () => {
    expect(groupByCategory([], [cat('x')])).toEqual([]);
  });
});
