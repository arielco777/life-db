import { z } from 'zod';
import { DomainError } from './errors';
import { isISODate } from './services/clock';
import type { Habit } from './types';
import { WEEKDAYS } from './types';

export const isoDate = z.string().refine(isISODate, 'Expected a date in YYYY-MM-DD form');
const uuid = z.string().min(1);
const optText = z.string().trim().max(10_000).optional();

export const habitTargetSchema = z.object({
  value: z.number().finite().nonnegative(),
  op: z.enum(['at_least', 'at_most']),
  period: z.enum(['day', 'week', 'month']),
});

export const habitFrequencySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('daily') }),
  z.object({ type: z.literal('weekdays'), days: z.array(z.enum(WEEKDAYS as [string, ...string[]])).min(1) }),
  z.object({ type: z.literal('times_per_week'), count: z.number().int().min(1).max(7) }),
]);

export const ratingScaleSchema = z
  .object({ min: z.number().int(), max: z.number().int() })
  .refine((s) => s.max > s.min, 'Rating max must be greater than min');

export const newHabitSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    description: optText,
    type: z.enum(['boolean', 'number', 'duration', 'rating']),
    unit: z.string().trim().max(40).optional(),
    ratingScale: ratingScaleSchema.optional(),
    target: habitTargetSchema.optional(),
    frequency: habitFrequencySchema.optional(),
    categoryId: uuid.optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    tagIds: z.array(uuid).optional(),
  })
  .refine((h) => !h.startDate || !h.endDate || h.endDate >= h.startDate, {
    message: 'End date must not be before start date',
    path: ['endDate'],
  });

export const newCategorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  color: z.string().trim().max(32).optional(),
  icon: z.string().trim().max(32).optional(),
});

export const newJournalEntrySchema = z.object({
  entryDate: isoDate,
  title: z.string().trim().max(500).optional(),
  body: z.string().max(1_000_000).optional(),
  categoryId: uuid.optional(),
  tagIds: z.array(uuid).optional(),
});

/** Parses with a zod schema and converts failures into a DomainError('validation'). */
export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const msg = r.error.issues
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');
    throw new DomainError('validation', msg);
  }
  return r.data;
}

/** ENT-4: validates an entry value against the habit's type. */
export function validateEntryValue(habit: Pick<Habit, 'type' | 'ratingScale'>, value: number): void {
  if (!Number.isFinite(value)) throw new DomainError('validation', 'Value must be a number');
  switch (habit.type) {
    case 'boolean':
      if (value !== 0 && value !== 1) throw new DomainError('validation', 'Boolean value must be 0 or 1');
      return;
    case 'number':
      if (value < 0) throw new DomainError('validation', 'Value must be ≥ 0');
      return;
    case 'duration':
      if (value < 0 || !Number.isInteger(value))
        throw new DomainError('validation', 'Duration must be a whole number of minutes ≥ 0');
      return;
    case 'rating': {
      const { min, max } = habit.ratingScale ?? { min: 1, max: 10 };
      if (!Number.isInteger(value) || value < min || value > max)
        throw new DomainError('validation', `Rating must be a whole number from ${min} to ${max}`);
      return;
    }
  }
}

/** TAG-3: trimmed, lowercase, inner whitespace collapsed. */
export const normalizeTagName = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, ' ');
