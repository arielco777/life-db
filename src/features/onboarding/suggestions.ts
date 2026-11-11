import { DEFAULT_CATEGORY_IDS } from '@/domain/ids';
import type { NewHabit } from '@/domain/repositories';

export interface Suggestion {
  /** What the checkbox says under the name. */
  hint: string;
  habit: NewHabit;
}

/** The habits offered on first run (SET-1). Each can be edited later like any other. */
export const SUGGESTIONS: Suggestion[] = [
  {
    hint: 'Minutes of exercise',
    habit: { name: 'Exercise', type: 'duration', categoryId: DEFAULT_CATEGORY_IDS.health },
  },
  {
    hint: 'Minutes of reading',
    habit: { name: 'Read', type: 'duration', categoryId: DEFAULT_CATEGORY_IDS.learning },
  },
  {
    hint: 'Done or not',
    habit: { name: 'Meditate', type: 'boolean', categoryId: DEFAULT_CATEGORY_IDS.health },
  },
  {
    hint: 'How long you slept',
    habit: { name: 'Sleep', type: 'duration', categoryId: DEFAULT_CATEGORY_IDS.health },
  },
  {
    hint: 'Cups, at most 3 a day',
    habit: {
      name: 'Coffee',
      type: 'number',
      unit: 'cups',
      target: { value: 3, op: 'at_most', period: 'day' },
      categoryId: DEFAULT_CATEGORY_IDS.health,
    },
  },
  {
    hint: 'A rating from 1 to 10',
    habit: {
      name: 'Mood',
      type: 'rating',
      ratingScale: { min: 1, max: 10 },
      categoryId: DEFAULT_CATEGORY_IDS.personal,
    },
  },
];
