import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Bucket } from '@/domain/services/series';

interface BarChartProps {
  buckets: Bucket[];
  unit: 'day' | 'week';
  /** Names the chart, e.g. "Run, August 2026". */
  title: string;
  /** Formats a value for the axis, tooltip and table. */
  format(value: number): string;
  /** Formats a bucket's dates, e.g. "Aug 14" or "Aug 10 – Aug 16". */
  dateLabel(b: Bucket): string;
  /** Fixed top of the scale, e.g. 1 for yes/no by day, the scale max for ratings. */
  max?: number;
}

const HEIGHT = 120;
const AXIS = 18; // room for the x labels under the baseline
const LEFT = 40; // room for the y labels
const BAR_MAX = 24;
const GAP = 2;
const RADIUS = 4;

/** Clean top of the y scale: 1, 2, 2.5, 5 × 10ⁿ at or above the data max. */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find((m) => m * exp >= v) ?? 10) * exp;
}

/** A column with a rounded data end and a square foot on the baseline. */
function barPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(RADIUS, w / 2, h);
  const base = y + h;
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`;
}

/** Tracks an element's width; jsdom and first paint fall back to a sensible default. */
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry!.contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * One habit's values over a period as columns (ANL-3): one bar per day, or per week for
 * long periods. A single series, so no legend: the title names it. Hover a bar, or focus
 * the chart and use ←/→, to read a value; "Show as table" lists them all.
 */
export function BarChart({ buckets, unit, title, format, dateLabel, max }: BarChartProps) {
  const ids = useId();
  const [ref, width] = useWidth(560);
  const [active, setActive] = useState<number | null>(null);
  const dataMax = Math.max(0, ...buckets.map((b) => b.value ?? 0));
  const top = max ?? niceMax(dataMax);
  const plotW = Math.max(0, width - LEFT);
  const slot = buckets.length ? plotW / buckets.length : plotW;
  const barW = Math.max(1, Math.min(BAR_MAX, slot - GAP));
  const y = (v: number) => HEIGHT - (Math.min(v, top) / top) * HEIGHT;
  const logged = buckets.filter((b) => b.value !== null).length;
  const describe = (b: Bucket) => `${dateLabel(b)}: ${b.value === null ? 'nothing logged' : format(b.value)}`;
  const labelIdx = [...new Set([0, Math.floor((buckets.length - 1) / 2), buckets.length - 1])].filter(
    (i) => i >= 0,
  );

  const onKey = (e: KeyboardEvent) => {
    const last = buckets.length - 1;
    const cur = active ?? -1;
    const next =
      e.key === 'ArrowRight'
        ? Math.min(last, cur + 1)
        : e.key === 'ArrowLeft'
          ? Math.max(0, cur === -1 ? last : cur - 1)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
  };

  const shown = active === null ? undefined : buckets[active];
  return (
    <div className="bar-chart stack-xs">
      <div
        ref={ref}
        className="chart-frame"
        tabIndex={0}
        role="group"
        aria-label={`${title}, ${unit === 'week' ? 'by week' : 'by day'}. ${logged} of ${buckets.length} ${unit}s logged. Use the arrow keys to read values.`}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
        onPointerMove={(e) => {
          const x = e.clientX - e.currentTarget.getBoundingClientRect().left - LEFT;
          const i = Math.floor(x / slot);
          setActive(i >= 0 && i < buckets.length ? i : null);
        }}
      >
        <svg width={width} height={HEIGHT + AXIS} aria-hidden focusable="false">
          {/* Recessive scale: a hairline at the top value and the baseline. */}
          <line className="chart-grid" x1={LEFT} x2={width} y1={0.5} y2={0.5} />
          <text className="chart-tick" x={LEFT - 6} y={4} textAnchor="end" dominantBaseline="hanging">
            {format(top)}
          </text>
          <text className="chart-tick" x={LEFT - 6} y={HEIGHT} textAnchor="end">
            0
          </text>
          {buckets.map((b, i) => {
            if (!b.value) return null;
            const h = HEIGHT - y(b.value);
            return (
              <path
                key={b.from}
                className={`chart-bar${active === i ? ' active' : ''}`}
                d={barPath(LEFT + i * slot + (slot - barW) / 2, y(b.value), barW, h)}
              />
            );
          })}
          <line className="chart-axis" x1={LEFT} x2={width} y1={HEIGHT + 0.5} y2={HEIGHT + 0.5} />
          {labelIdx.map((i, n) => (
            <text
              key={i}
              className="chart-tick"
              x={LEFT + i * slot + slot / 2}
              y={HEIGHT + AXIS - 4}
              textAnchor={
                n === 0 && labelIdx.length > 1
                  ? 'start'
                  : n === labelIdx.length - 1 && i !== 0
                    ? 'end'
                    : 'middle'
              }
            >
              {dateLabel({ ...buckets[i]!, to: buckets[i]!.from })}
            </text>
          ))}
        </svg>
        {shown && (
          <div
            className="chart-tooltip"
            style={{
              left: Math.min(Math.max(LEFT + active! * slot + slot / 2, 60), width - 60),
            }}
          >
            <strong>{shown.value === null ? '–' : format(shown.value)}</strong>
            <span className="small muted">{dateLabel(shown)}</span>
          </div>
        )}
        <span className="sr-only" aria-live="polite">
          {shown ? describe(shown) : ''}
        </span>
      </div>
      <details className="chart-table">
        <summary className="small">Show as table</summary>
        <table aria-labelledby={`${ids}-caption`}>
          <caption id={`${ids}-caption`} className="sr-only">
            {title}
          </caption>
          <thead>
            <tr>
              <th scope="col">{unit === 'week' ? 'Week' : 'Day'}</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.from}>
                <th scope="row">{dateLabel(b)}</th>
                <td>{b.value === null ? '–' : format(b.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
