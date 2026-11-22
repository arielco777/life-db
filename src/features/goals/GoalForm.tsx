import { useId, useState, type FormEvent } from 'react';
import { MODE_LABELS, STATUS_LABELS, STATUS_ORDER } from './describe';
import type { NewGoal } from '@/domain/repositories';
import type { Goal, GoalStatus, Priority, ProgressMode, UUID } from '@/domain/types';
import { CategorySelect } from '@/features/categories/CategorySelect';
import { parseNumber } from '@/features/habits/inputs/NumberInput';
import { TagInput } from '@/features/tags/TagInput';
import { Field } from '@/ui/Field';

export interface GoalDraft {
  title: string;
  description: string;
  categoryId?: UUID;
  priority: Priority;
  status: GoalStatus;
  progressMode: ProgressMode;
  manual: string;
  current: string;
  target: string;
  unit: string;
  startDate: string;
  targetDate: string;
  tagIds: UUID[];
}

const num = (n: number | undefined) => (n === undefined ? '' : String(n));

export function draftFrom(g?: Goal): GoalDraft {
  return {
    title: g?.title ?? '',
    description: g?.description ?? '',
    categoryId: g?.categoryId,
    priority: g?.priority ?? 'medium',
    status: g?.status ?? 'active',
    progressMode: g?.progressMode ?? 'milestones',
    manual: num(g?.progressManual),
    current: num(g?.progressCurrent),
    target: num(g?.progressTarget),
    unit: g?.progressUnit ?? '',
    startDate: g?.startDate ?? '',
    targetDate: g?.targetDate ?? '',
    tagIds: g?.tagIds ?? [],
  };
}

type Errors = Partial<Record<'title' | 'manual' | 'current' | 'target' | 'targetDate', string>>;

/**
 * Validates the draft (GOAL-1, GOAL-4) and builds repository input, or returns field errors.
 * Values of the other progress modes are kept, so switching modes back restores them.
 */
export function toInput(
  d: GoalDraft,
): { input: NewGoal; errors?: undefined } | { input?: undefined; errors: Errors } {
  const errors: Errors = {};
  if (!d.title.trim()) errors.title = 'Give the goal a title';
  if (d.startDate && d.targetDate && d.targetDate < d.startDate)
    errors.targetDate = 'The target date is before the start date';

  // Only the chosen mode's fields are checked. The others keep their value if it's valid.
  const manual = parseNumber(d.manual);
  const current = parseNumber(d.current);
  const target = parseNumber(d.target);
  const badManual = manual === null || (manual !== undefined && manual > 100);
  const badTarget = target === null || target === 0;
  if (d.progressMode === 'manual' && badManual) errors.manual = 'A percentage from 0 to 100';
  if (d.progressMode === 'numeric') {
    if (current === null) errors.current = 'Enter a number ≥ 0';
    if (badTarget) errors.target = 'Enter a target greater than 0';
    else if (target === undefined) errors.target = 'Enter the target to reach';
  }

  if (Object.keys(errors).length) return { errors };
  return {
    input: {
      title: d.title.trim(),
      description: d.description.trim() || undefined,
      categoryId: d.categoryId,
      priority: d.priority,
      status: d.status,
      progressMode: d.progressMode,
      progressManual: badManual ? undefined : manual,
      progressCurrent: current ?? undefined,
      progressTarget: badTarget ? undefined : target,
      progressUnit: d.unit.trim() || undefined,
      startDate: d.startDate || undefined,
      targetDate: d.targetDate || undefined,
      tagIds: d.tagIds,
    },
  };
}

interface GoalFormProps {
  initial: GoalDraft;
  submitLabel: string;
  busy?: boolean;
  onSubmit(input: NewGoal): void;
  onCancel(): void;
}

/** Create / edit form for a goal (tasks 11.4, GOAL-1, GOAL-2, GOAL-4). */
export function GoalForm({ initial, submitLabel, busy, onSubmit, onCancel }: GoalFormProps) {
  const [d, setD] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const ids = useId();
  const set = <K extends keyof GoalDraft>(k: K, v: GoalDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = toInput(d);
    if (r.errors) {
      setErrors(r.errors);
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('.goal-form [aria-invalid="true"]')?.focus(),
      );
      return;
    }
    setErrors({});
    onSubmit(r.input);
  };

  return (
    <form className="goal-form stack" onSubmit={submit} noValidate>
      <Field label="Title" id={`${ids}-title`} error={errors.title}>
        <input
          id={`${ids}-title`}
          value={d.title}
          maxLength={200}
          autoFocus
          aria-invalid={!!errors.title}
          onChange={(e) => set('title', e.target.value)}
        />
      </Field>

      <fieldset className="field">
        <legend>Measure progress by</legend>
        <div className="type-options">
          {(Object.keys(MODE_LABELS) as ProgressMode[]).map((m) => (
            <label key={m} className={`type-option${d.progressMode === m ? ' on' : ''}`}>
              <input
                type="radio"
                name={`${ids}-mode`}
                value={m}
                checked={d.progressMode === m}
                onChange={() => set('progressMode', m)}
              />
              <strong>{MODE_LABELS[m].label}</strong>
              <span className="small muted">{MODE_LABELS[m].hint}</span>
            </label>
          ))}
        </div>
        {d.progressMode === 'milestones' && (
          <p className="small muted">Add milestones on the goal's page once it's created.</p>
        )}
        {d.progressMode === 'manual' && (
          <div className="row">
            <input
              aria-label="Progress, percent"
              className="short"
              inputMode="decimal"
              placeholder="0"
              value={d.manual}
              aria-invalid={!!errors.manual}
              onChange={(e) => set('manual', e.target.value)}
            />
            <span className="muted">% done</span>
          </div>
        )}
        {d.progressMode === 'numeric' && (
          <div className="row">
            <input
              aria-label="Current value"
              className="short"
              inputMode="decimal"
              placeholder="0"
              value={d.current}
              aria-invalid={!!errors.current}
              onChange={(e) => set('current', e.target.value)}
            />
            <span>of</span>
            <input
              aria-label="Target value"
              className="short"
              inputMode="decimal"
              value={d.target}
              aria-invalid={!!errors.target}
              onChange={(e) => set('target', e.target.value)}
            />
            <input
              aria-label="Unit"
              className="short"
              placeholder="unit, e.g. books"
              maxLength={40}
              value={d.unit}
              onChange={(e) => set('unit', e.target.value)}
            />
          </div>
        )}
        {(() => {
          const msg =
            d.progressMode === 'manual'
              ? errors.manual
              : d.progressMode === 'numeric'
                ? (errors.current ?? errors.target)
                : undefined;
          return msg && <p className="field-msg error">{msg}</p>;
        })()}
      </fieldset>

      <div className="form-grid">
        <Field label="Status" id={`${ids}-status`}>
          <select
            id={`${ids}-status`}
            value={d.status}
            onChange={(e) => set('status', e.target.value as GoalStatus)}
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
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
        <Field label="Start date" id={`${ids}-start`} hint="Optional">
          <input
            id={`${ids}-start`}
            type="date"
            value={d.startDate}
            onChange={(e) => set('startDate', e.target.value)}
          />
        </Field>
        <Field label="Target date" id={`${ids}-target-date`} hint="Optional" error={errors.targetDate}>
          <input
            id={`${ids}-target-date`}
            type="date"
            value={d.targetDate}
            min={d.startDate || undefined}
            aria-invalid={!!errors.targetDate}
            onChange={(e) => set('targetDate', e.target.value)}
          />
        </Field>
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
