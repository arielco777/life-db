import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { orderedWeekdays, TYPE_LABELS, WEEKDAY_SHORT } from './describe';
import { parseNumber } from './inputs/NumberInput';
import type { NewHabit } from '@/domain/repositories';
import { formatDuration, parseDuration } from '@/domain/services/format';
import type { Habit, HabitTarget, HabitType, ISODate, Priority, UUID, Weekday } from '@/domain/types';
import { CategorySelect } from '@/features/categories/CategorySelect';
import { useSettings } from '@/features/settings/hooks';
import { TagInput } from '@/features/tags/TagInput';

export interface HabitDraft {
  name: string;
  description: string;
  type: HabitType;
  unit: string;
  ratingMin: string;
  ratingMax: string;
  frequency: 'daily' | 'weekdays' | 'times_per_week';
  days: Weekday[];
  /** Weekday habits: the other days are rest days (HAB-5) rather than optional. */
  rest: boolean;
  count: string;
  hasTarget: boolean;
  targetOp: HabitTarget['op'];
  targetValue: string;
  targetPeriod: HabitTarget['period'];
  categoryId?: UUID;
  priority: Priority;
  startDate: ISODate;
  /** "Never" vs "On a date": explicit, so an empty date box never silently means "no end". */
  hasEnd: boolean;
  endDate: string;
  tagIds: UUID[];
}

export function draftFrom(h: Habit | undefined, today: ISODate): HabitDraft {
  const f = h?.frequency;
  return {
    name: h?.name ?? '',
    description: h?.description ?? '',
    type: h?.type ?? 'boolean',
    unit: h?.unit ?? '',
    ratingMin: String(h?.ratingScale?.min ?? 1),
    ratingMax: String(h?.ratingScale?.max ?? 10),
    frequency: f?.type ?? 'daily',
    days: f?.type === 'weekdays' ? f.days : ['mon', 'wed', 'fri'],
    rest: f?.type === 'weekdays' && !!f.restOnOtherDays,
    count: String(f?.type === 'times_per_week' ? f.count : 3),
    hasTarget: !!h?.target,
    targetOp: h?.target?.op ?? 'at_least',
    targetValue: h?.target
      ? h.type === 'duration'
        ? formatDuration(h.target.value)
        : String(h.target.value)
      : '',
    targetPeriod: h?.target?.period ?? (h?.type === 'boolean' ? 'week' : 'day'),
    categoryId: h?.categoryId,
    priority: h?.priority ?? 'medium',
    startDate: h?.startDate ?? today,
    hasEnd: !!h?.endDate,
    endDate: h?.endDate ?? '',
    tagIds: h?.tagIds ?? [],
  };
}

type Errors = Partial<
  Record<'name' | 'rating' | 'days' | 'count' | 'target' | 'endDate' | 'startDate', string>
>;

const intIn = (s: string, lo: number, hi: number) => {
  const n = Number(s);
  return /^\d+$/.test(s.trim()) && n >= lo && n <= hi ? n : null;
};

/** Validates the draft (HAB-1…6) and builds repository input, or returns field errors. */
export function toInput(
  d: HabitDraft,
): { input: NewHabit; errors?: undefined } | { input?: undefined; errors: Errors } {
  const errors: Errors = {};
  if (!d.name.trim()) errors.name = 'Give the habit a name';
  if (!d.startDate) errors.startDate = 'Pick a start date';
  if (d.hasEnd && !d.endDate) errors.endDate = 'Pick an end date, or choose Never';
  else if (d.hasEnd && d.endDate < d.startDate) errors.endDate = 'The end date is before the start date';

  let ratingScale: NewHabit['ratingScale'];
  if (d.type === 'rating') {
    const min = intIn(d.ratingMin, 0, 1);
    const max = intIn(d.ratingMax, 2, 100);
    if (min === null || max === null) errors.rating = 'The scale runs from 0 or 1 up to 2–100';
    else ratingScale = { min, max };
  }

  let frequency: NewHabit['frequency'] = { type: 'daily' };
  if (d.frequency === 'weekdays') {
    if (d.days.length === 0) errors.days = 'Pick at least one day';
    frequency = { type: 'weekdays', days: d.days, ...(d.rest ? { restOnOtherDays: true } : {}) };
  } else if (d.frequency === 'times_per_week') {
    const count = intIn(d.count, 1, 7);
    if (count === null) errors.count = 'Between 1 and 7 times';
    else frequency = { type: 'times_per_week', count };
  }

  let target: HabitTarget | undefined;
  if (d.hasTarget) {
    const raw = d.targetValue.trim();
    const value =
      d.type === 'duration'
        ? parseDuration(raw)
        : d.type === 'boolean'
          ? intIn(raw, 1, 31)
          : (parseNumber(raw) ?? null);
    const scale = ratingScale ?? { min: 1, max: 10 };
    if (value === null || (d.type === 'rating' && (value < scale.min || value > scale.max)))
      errors.target = {
        boolean: 'How many times, from 1 to 31',
        number: 'Enter an amount ≥ 0',
        duration: 'Try 30, 0:30 or 1h',
        rating: `A rating from ${scale.min} to ${scale.max}`,
      }[d.type];
    else target = { value, op: d.targetOp, period: d.targetPeriod };
  }

  if (Object.keys(errors).length) return { errors };
  return {
    input: {
      name: d.name.trim(),
      description: d.description.trim() || undefined,
      type: d.type,
      unit: d.type === 'number' ? d.unit.trim() || undefined : undefined,
      ratingScale,
      target,
      frequency,
      categoryId: d.categoryId,
      priority: d.priority,
      startDate: d.startDate,
      endDate: d.hasEnd ? d.endDate : undefined,
      tagIds: d.tagIds,
    },
  };
}

interface HabitFormProps {
  initial: HabitDraft;
  /** Type and rating scale can't change once the habit has entries (HAB-2). */
  locked?: boolean;
  submitLabel: string;
  busy?: boolean;
  onSubmit(input: NewHabit): void;
  onCancel(): void;
}

/** Create / edit form for a habit (tasks 4.2, HAB-1…7). */
export function HabitForm({ initial, locked, submitLabel, busy, onSubmit, onCancel }: HabitFormProps) {
  const { week_start } = useSettings();
  const [d, setD] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const ids = useId();
  const set = <K extends keyof HabitDraft>(k: K, v: HabitDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = toInput(d);
    if (r.errors) {
      setErrors(r.errors);
      // Move focus to the first problem so keyboard users land on it.
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('.habit-form [aria-invalid="true"]')?.focus(),
      );
      return;
    }
    setErrors({});
    onSubmit(r.input);
  };

  const targetUnit =
    d.type === 'boolean'
      ? 'times'
      : d.type === 'number'
        ? d.unit || ''
        : d.type === 'rating'
          ? 'average'
          : '';

  return (
    <form className="habit-form stack" onSubmit={submit} noValidate>
      <Field label="Name" id={`${ids}-name`} error={errors.name}>
        <input
          id={`${ids}-name`}
          value={d.name}
          maxLength={200}
          autoFocus
          aria-invalid={!!errors.name}
          onChange={(e) => set('name', e.target.value)}
        />
      </Field>

      <fieldset className="field" disabled={locked}>
        <legend>Type</legend>
        {locked && (
          <p className="small muted">
            This habit has entries, so its type{d.type === 'rating' ? ' and scale' : ''} can't change. Archive
            it and create a new one instead.
          </p>
        )}
        <div className="type-options">
          {(Object.keys(TYPE_LABELS) as HabitType[]).map((t) => (
            <label key={t} className={`type-option${d.type === t ? ' on' : ''}`}>
              <input
                type="radio"
                name={`${ids}-type`}
                value={t}
                checked={d.type === t}
                onChange={() =>
                  setD((x) => ({
                    ...x,
                    type: t,
                    targetValue: '',
                    targetPeriod: t === 'boolean' && x.targetPeriod === 'day' ? 'week' : x.targetPeriod,
                  }))
                }
              />
              <strong>{TYPE_LABELS[t].label}</strong>
              <span className="small muted">{TYPE_LABELS[t].hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {d.type === 'number' && (
        <Field label="Unit" id={`${ids}-unit`} hint="Optional, e.g. cups, L, km">
          <input
            id={`${ids}-unit`}
            value={d.unit}
            maxLength={40}
            className="short"
            onChange={(e) => set('unit', e.target.value)}
          />
        </Field>
      )}

      {d.type === 'rating' && (
        <fieldset className="field" disabled={locked}>
          <legend>Scale</legend>
          <div className="row">
            <select
              aria-label="Lowest rating"
              value={d.ratingMin}
              onChange={(e) => set('ratingMin', e.target.value)}
            >
              <option value="0">0</option>
              <option value="1">1</option>
            </select>
            <span>to</span>
            <input
              aria-label="Highest rating"
              className="short"
              inputMode="numeric"
              value={d.ratingMax}
              aria-invalid={!!errors.rating}
              onChange={(e) => set('ratingMax', e.target.value)}
            />
          </div>
          {errors.rating && <p className="field-msg error">{errors.rating}</p>}
        </fieldset>
      )}

      <fieldset className="field">
        <legend>Schedule</legend>
        <div className="row">
          <select
            aria-label="Schedule"
            value={d.frequency}
            onChange={(e) => set('frequency', e.target.value as HabitDraft['frequency'])}
          >
            <option value="daily">Every day</option>
            <option value="weekdays">On specific days</option>
            <option value="times_per_week">A number of times per week</option>
          </select>
          {d.frequency === 'times_per_week' && (
            <>
              <input
                aria-label="Times per week"
                className="short"
                inputMode="numeric"
                value={d.count}
                aria-invalid={!!errors.count}
                onChange={(e) => set('count', e.target.value)}
              />
              <span>times a week</span>
            </>
          )}
        </div>
        {d.frequency === 'weekdays' && (
          <div className="weekday-picker" role="group" aria-label="Days">
            {orderedWeekdays(week_start).map((day) => {
              const on = d.days.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  className={on ? 'on' : undefined}
                  onClick={() => set('days', on ? d.days.filter((x) => x !== day) : [...d.days, day])}
                >
                  {WEEKDAY_SHORT[day]}
                </button>
              );
            })}
          </div>
        )}
        {(errors.days || errors.count) && <p className="field-msg error">{errors.days ?? errors.count}</p>}
        {d.frequency === 'weekdays' && (
          <div className="other-days" role="radiogroup" aria-label="Other days">
            <span className="small muted">Other days:</span>
            <label className="check-row row">
              <input
                type="radio"
                name={`${ids}-rest`}
                checked={!d.rest}
                onChange={() => set('rest', false)}
              />
              <span>Optional – can still be done</span>
            </label>
            <label className="check-row row">
              <input type="radio" name={`${ids}-rest`} checked={d.rest} onChange={() => set('rest', true)} />
              <span>Rest days – shouldn’t be done</span>
            </label>
          </div>
        )}
      </fieldset>

      <fieldset className="field">
        <legend>Target</legend>
        <label className="row check-row">
          <input type="checkbox" checked={d.hasTarget} onChange={(e) => set('hasTarget', e.target.checked)} />
          <span>Set a target</span>
        </label>
        {d.hasTarget && (
          <div className="row">
            <select
              aria-label="Target comparison"
              value={d.targetOp}
              onChange={(e) => set('targetOp', e.target.value as HabitTarget['op'])}
            >
              <option value="at_least">At least</option>
              <option value="at_most">At most</option>
            </select>
            <input
              aria-label="Target value"
              className="short"
              inputMode={d.type === 'duration' ? 'text' : 'decimal'}
              placeholder={d.type === 'duration' ? '0:30' : ''}
              value={d.targetValue}
              aria-invalid={!!errors.target}
              onChange={(e) => set('targetValue', e.target.value)}
            />
            {targetUnit && <span className="muted">{targetUnit}</span>}
            <select
              aria-label="Target period"
              value={d.targetPeriod}
              onChange={(e) => set('targetPeriod', e.target.value as HabitTarget['period'])}
            >
              {d.type !== 'boolean' && <option value="day">per day</option>}
              <option value="week">per week</option>
              <option value="month">per month</option>
            </select>
          </div>
        )}
        {errors.target && <p className="field-msg error">{errors.target}</p>}
      </fieldset>

      <div className="form-grid">
        <Field label="Category" id={`${ids}-cat`}>
          <CategorySelect id={`${ids}-cat`} value={d.categoryId} onChange={(v) => set('categoryId', v)} />
        </Field>
        <fieldset className="field">
          <legend>Priority</legend>
          <div className="segmented">
            {(['low', 'medium', 'high'] as Priority[]).map((p) => (
              <label key={p} className={d.priority === p ? 'on' : undefined}>
                <input
                  type="radio"
                  name={`${ids}-priority`}
                  checked={d.priority === p}
                  onChange={() => set('priority', p)}
                />
                {p[0]!.toUpperCase() + p.slice(1)}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Starts" id={`${ids}-start`} error={errors.startDate}>
          <input
            id={`${ids}-start`}
            type="date"
            value={d.startDate}
            aria-invalid={!!errors.startDate}
            onChange={(e) => set('startDate', e.target.value)}
          />
        </Field>
        <fieldset className="field">
          <legend>Ends</legend>
          <div className="end-options">
            <label className="check-row row">
              <input
                type="radio"
                name={`${ids}-ends`}
                checked={!d.hasEnd}
                onChange={() => set('hasEnd', false)}
              />
              <span>Never</span>
            </label>
            <label className="check-row row">
              <input
                type="radio"
                name={`${ids}-ends`}
                checked={d.hasEnd}
                onChange={() => set('hasEnd', true)}
              />
              <span>On a date</span>
            </label>
            {d.hasEnd && (
              <input
                type="date"
                aria-label="End date"
                value={d.endDate}
                min={d.startDate}
                aria-invalid={!!errors.endDate}
                onChange={(e) => set('endDate', e.target.value)}
              />
            )}
          </div>
          {errors.endDate && <p className="field-msg error">{errors.endDate}</p>}
        </fieldset>
      </div>

      <Field label="Tags" id={`${ids}-tags`}>
        <TagInput id={`${ids}-tags`} value={d.tagIds} onChange={(v) => set('tagIds', v)} />
      </Field>

      <Field label="Description" id={`${ids}-desc`} hint="Optional">
        <textarea
          id={`${ids}-desc`}
          rows={3}
          value={d.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </Field>

      <div className="row form-actions">
        <button type="submit" disabled={busy}>
          {submitLabel}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({
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
