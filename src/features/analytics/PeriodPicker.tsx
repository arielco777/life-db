import { useId } from 'react';
import { PERIOD_KINDS, periodAround, periodLabel, shiftPeriod, type Period, type PeriodKind } from './period';
import { isISODate } from '@/domain/services/clock';
import type { ISODate } from '@/domain/types';
import { useSettings } from '@/features/settings/hooks';

const KIND_LABELS: Record<PeriodKind, string> = {
  week: 'Week',
  month: 'Month',
  year: 'Year',
  custom: 'Custom',
};

/** Week / month / year / custom, with ‹ › to step through periods (tasks 13.1, ANL-1). */
export function PeriodPicker({
  period,
  onChange,
  today,
}: {
  period: Period;
  onChange(p: Period): void;
  today: ISODate;
}) {
  const ids = useId();
  const { week_start, date_format } = useSettings();
  const pick = (kind: PeriodKind) => {
    if (kind === period.kind) return;
    // Keep looking at the same time: the new period contains the start of the old one,
    // or today when today is inside it.
    const anchor = today >= period.range.from && today <= period.range.to ? today : period.range.from;
    onChange(kind === 'custom' ? { kind, range: period.range } : periodAround(kind, anchor, week_start));
  };
  // Moving one end past the other drags the other along, so the range stays valid.
  const setFrom = (from: string) =>
    isISODate(from) &&
    onChange({ kind: 'custom', range: { from, to: from > period.range.to ? from : period.range.to } });
  const setTo = (to: string) =>
    isISODate(to) &&
    onChange({ kind: 'custom', range: { from: to < period.range.from ? to : period.range.from, to } });
  const containsToday = today >= period.range.from && today <= period.range.to;

  return (
    <div className="period-picker row">
      <div className="segmented" role="radiogroup" aria-label="Period">
        {PERIOD_KINDS.map((k) => (
          <label key={k} className={period.kind === k ? 'on' : undefined}>
            <input type="radio" name={`${ids}-kind`} checked={period.kind === k} onChange={() => pick(k)} />
            {KIND_LABELS[k]}
          </label>
        ))}
      </div>
      <nav className="row period-nav" aria-label="Change period">
        <button
          type="button"
          className="secondary icon-btn"
          aria-label="Previous period"
          onClick={() => onChange(shiftPeriod(period, -1))}
        >
          ‹
        </button>
        <strong className="period-label" aria-live="polite">
          {periodLabel(period, date_format)}
        </strong>
        <button
          type="button"
          className="secondary icon-btn"
          aria-label="Next period"
          onClick={() => onChange(shiftPeriod(period, 1))}
        >
          ›
        </button>
        {period.kind !== 'custom' && (
          <button
            type="button"
            className="secondary"
            disabled={containsToday}
            onClick={() =>
              onChange(periodAround(period.kind as Exclude<PeriodKind, 'custom'>, today, week_start))
            }
          >
            Current
          </button>
        )}
      </nav>
      {period.kind === 'custom' && (
        <div className="row">
          <input
            type="date"
            aria-label="From"
            value={period.range.from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <span>to</span>
          <input
            type="date"
            aria-label="To"
            value={period.range.to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
