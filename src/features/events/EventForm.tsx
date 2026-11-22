import { useId, useState, type FormEvent } from 'react';
import type { NewLifeEvent } from '@/domain/repositories';
import type { ISODate, LifeEvent, UUID } from '@/domain/types';
import { CategorySelect } from '@/features/categories/CategorySelect';
import { TagInput } from '@/features/tags/TagInput';
import { Field } from '@/ui/Field';

export interface EventDraft {
  name: string;
  description: string;
  startDate: string;
  /** "One day" vs "Until a date": explicit, like a habit's end date. */
  isRange: boolean;
  endDate: string;
  categoryId?: UUID;
  tagIds: UUID[];
}

export const draftFrom = (e: LifeEvent | undefined, today: ISODate): EventDraft => ({
  name: e?.name ?? '',
  description: e?.description ?? '',
  startDate: e?.startDate ?? today,
  isRange: !!e?.endDate,
  endDate: e?.endDate ?? '',
  categoryId: e?.categoryId,
  tagIds: e?.tagIds ?? [],
});

type Errors = Partial<Record<'name' | 'startDate' | 'endDate', string>>;

/** Validates the draft (EVT-1) and builds repository input, or returns field errors. */
export function toInput(
  d: EventDraft,
): { input: NewLifeEvent; errors?: undefined } | { input?: undefined; errors: Errors } {
  const errors: Errors = {};
  if (!d.name.trim()) errors.name = 'Give the event a name';
  if (!d.startDate) errors.startDate = 'Pick the day it happened';
  if (d.isRange && !d.endDate) errors.endDate = 'Pick the last day, or choose One day';
  else if (d.isRange && d.endDate < d.startDate) errors.endDate = 'The last day is before the first';
  if (Object.keys(errors).length) return { errors };
  return {
    input: {
      name: d.name.trim(),
      description: d.description.trim() || undefined,
      startDate: d.startDate,
      endDate: d.isRange ? d.endDate : undefined,
      categoryId: d.categoryId,
      tagIds: d.tagIds,
    },
  };
}

interface EventFormProps {
  initial: EventDraft;
  submitLabel: string;
  busy?: boolean;
  /** The quick-add form on the events page: no description, no cancel, and it resets after saving. */
  quick?: boolean;
  /** Resolve to reset a quick form after a successful save. */
  onSubmit(input: NewLifeEvent): Promise<unknown> | void;
  onCancel?(): void;
}

/** Create / edit form for a life event (tasks 12.2, 12.3, EVT-1). */
export function EventForm({ initial, submitLabel, busy, quick, onSubmit, onCancel }: EventFormProps) {
  const ids = useId();
  const [d, setD] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const set = <K extends keyof EventDraft>(k: K, v: EventDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = toInput(d);
    if (r.errors) {
      setErrors(r.errors);
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(`[data-form="${ids}"] [aria-invalid="true"]`)?.focus(),
      );
      return;
    }
    setErrors({});
    try {
      await onSubmit(r.input);
      // Keep the dates, so several events on the same day are quick to add.
      if (quick) setD((x) => ({ ...initial, startDate: x.startDate }));
    } catch {
      // The mutation already showed the error; keep what was typed.
    }
  };

  return (
    <form className="stack event-form" data-form={ids} onSubmit={submit} noValidate>
      <Field label="Name" id={`${ids}-name`} error={errors.name}>
        <input
          id={`${ids}-name`}
          value={d.name}
          maxLength={200}
          autoFocus={!quick}
          placeholder={quick ? 'e.g. Vacation in Lisbon' : undefined}
          aria-invalid={!!errors.name}
          onChange={(e) => set('name', e.target.value)}
        />
      </Field>

      <div className="form-grid">
        <Field label="Date" id={`${ids}-start`} error={errors.startDate}>
          <input
            id={`${ids}-start`}
            type="date"
            value={d.startDate}
            aria-invalid={!!errors.startDate}
            onChange={(e) => set('startDate', e.target.value)}
          />
        </Field>
        <fieldset className="field">
          <legend>Lasts</legend>
          <div className="end-options">
            <label className="check-row row">
              <input
                type="radio"
                name={`${ids}-range`}
                checked={!d.isRange}
                onChange={() => set('isRange', false)}
              />
              <span>One day</span>
            </label>
            <label className="check-row row">
              <input
                type="radio"
                name={`${ids}-range`}
                checked={d.isRange}
                onChange={() => set('isRange', true)}
              />
              <span>Until a date</span>
            </label>
            {d.isRange && (
              <input
                type="date"
                aria-label="Last day"
                value={d.endDate}
                min={d.startDate || undefined}
                aria-invalid={!!errors.endDate}
                onChange={(e) => set('endDate', e.target.value)}
              />
            )}
          </div>
          {errors.endDate && <p className="field-msg error">{errors.endDate}</p>}
        </fieldset>
        <Field label="Category" id={`${ids}-cat`}>
          <CategorySelect id={`${ids}-cat`} value={d.categoryId} onChange={(v) => set('categoryId', v)} />
        </Field>
      </div>

      <Field label="Tags" id={`${ids}-tags`}>
        <TagInput id={`${ids}-tags`} value={d.tagIds} onChange={(v) => set('tagIds', v)} />
      </Field>

      {!quick && (
        <Field label="Description" id={`${ids}-desc`} hint="Optional">
          <textarea
            id={`${ids}-desc`}
            rows={3}
            value={d.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </Field>
      )}

      <div className="row form-actions">
        <button type="submit" disabled={busy}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
