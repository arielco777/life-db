import {
  createContext,
  memo,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { Link } from 'react-router-dom';
import { dayLong, monthTitle, weekdayShort } from './labels';
import { summaryLines } from './summary';
import { eachDay, monthRange, weekdayOf } from '@/domain/services/dates';
import { formatDuration, formatValue, parseDuration } from '@/domain/services/format';
import { isActiveOn, isRestDay, isScheduled, restDaysLogged } from '@/domain/services/schedule';
import { computeStats } from '@/domain/services/stats';
import { evaluateTarget, type TargetStatus, type ValuesByDate } from '@/domain/services/targets';
import type { Habit, ISODate, ISOMonth } from '@/domain/types';
import { useCategories } from '@/features/categories/hooks';
import { useClearEntry, useSetEntry } from '@/features/habits/entryHooks';
import { parseNumber } from '@/features/habits/inputs/NumberInput';
import { RatingPicker } from '@/features/habits/inputs/RatingPicker';
import { useSettings } from '@/features/settings/hooks';

interface GridProps {
  ym: ISOMonth;
  habits: Habit[];
  valuesByHabit: Map<string, ValuesByDate>;
  today: ISODate;
}

type Pos = { row: number; col: number };
type Move = 'down' | 'right' | 'stay';

interface GridActions {
  /** Saves a value (undefined clears it). */
  commit(habit: Habit, date: ISODate, value: number | undefined): void;
  startEdit(pos: Pos, initial?: string): void;
  /** Closes the editor and moves focus. */
  endEdit(move: Move): void;
  focus(pos: Pos): void;
}
const Actions = createContext<GridActions | null>(null);
const useActions = () => useContext(Actions)!;

const EMPTY: ValuesByDate = new Map();

/**
 * The paper-tracker grid (MON-1, MON-3): one row per day, one column per habit. It follows
 * the ARIA grid pattern — Tab enters and leaves the grid, arrows move inside it (↑/↓ day,
 * ←/→ habit). A checkbox cell toggles on click/Space/Enter; other cells open a small editor
 * on click, Enter or a typed digit. Cells are memoised on primitive props, so editing one
 * re-renders only that cell and the summary row (NFR-1).
 */
export function MonthGrid({ ym, habits, valuesByHabit, today }: GridProps) {
  const { week_start } = useSettings();
  const { data: categories = [] } = useCategories();
  const colors = useMemo(() => new Map(categories.map((c) => [c.id, c.color])), [categories]);
  const range = monthRange(ym);
  const days = eachDay(range);
  const setEntry = useSetEntry();
  const clearEntry = useClearEntry();

  const todayRow = days.indexOf(today);
  const [active, setActive] = useState<Pos>({ row: Math.max(0, todayRow), col: 0 });
  const [editing, setEditing] = useState<{ pos: Pos; initial?: string } | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const tableRef = useRef<HTMLTableElement>(null);
  const clamp = (p: Pos): Pos => ({
    row: Math.min(days.length - 1, Math.max(0, p.row)),
    col: Math.min(habits.length - 1, Math.max(0, p.col)),
  });

  // Move DOM focus after the roving tab stop has re-rendered.
  useEffect(() => {
    // While an editor is open it owns focus (its input autofocuses).
    if (focusTick === 0 || editing) return;
    tableRef.current?.querySelector<HTMLElement>(`[data-pos="${active.row}:${active.col}"]`)?.focus();
  }, [focusTick, active, editing]);

  const actionsRef = useRef<GridActions>(null!);
  const latest: GridActions = {
    commit: (habit, date, value) =>
      value === undefined
        ? clearEntry.mutate({ habitId: habit.id, date })
        : setEntry.mutate({ habit, date, value }),
    startEdit: (pos, initial) => {
      setActive(pos);
      setEditing({ pos, initial });
    },
    endEdit: (move) => {
      const from = editing?.pos ?? active;
      setEditing(null);
      setActive(
        clamp(
          move === 'down'
            ? { ...from, row: from.row + 1 }
            : move === 'right'
              ? { ...from, col: from.col + 1 }
              : from,
        ),
      );
      setFocusTick((t) => t + 1);
    },
    focus: (pos) => {
      setActive(clamp(pos));
      setFocusTick((t) => t + 1);
    },
  };
  useLayoutEffect(() => {
    actionsRef.current = latest;
  });
  // Stable identity for memoised cells; always calls the latest closures.
  const actions = useMemo<GridActions>(
    () => ({
      commit: (...a) => actionsRef.current.commit(...a),
      startEdit: (...a) => actionsRef.current.startEdit(...a),
      endEdit: (...a) => actionsRef.current.endEdit(...a),
      focus: (...a) => actionsRef.current.focus(...a),
    }),
    [],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    if (editing || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-pos]');
    if (!target) return;
    const [row, col] = target.dataset.pos!.split(':').map(Number) as [number, number];
    const moves: Record<string, Pos> = {
      ArrowUp: { row: row - 1, col },
      ArrowDown: { row: row + 1, col },
      ArrowLeft: { row, col: col - 1 },
      ArrowRight: { row, col: col + 1 },
      Home: { row, col: 0 },
      End: { row, col: habits.length - 1 },
      PageUp: { row: row - 7, col },
      PageDown: { row: row + 7, col },
    };
    const to = moves[e.key];
    if (!to) return;
    e.preventDefault();
    actions.focus(to);
  };

  return (
    <Actions.Provider value={actions}>
      <div className="month-scroll">
        <table
          ref={tableRef}
          role="grid"
          aria-label={`Habits for ${monthTitle(ym)}`}
          className="month-grid"
          onKeyDown={onKeyDown}
        >
          <thead>
            <tr>
              <th scope="col" className="corner">
                <span className="sr-only">Day</span>
              </th>
              {habits.map((h) => {
                const name = h.type === 'number' && h.unit ? `${h.name} (${h.unit})` : h.name;
                return (
                  <th key={h.id} scope="col" className="habit-col" title={name}>
                    <div className="angled">
                      <span>{name}</span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {days.map((d, row) => {
              const wd = weekdayOf(d);
              const cls = [
                d === today && 'today',
                (wd === 'sat' || wd === 'sun') && 'weekend',
                d > today && 'future',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <tr key={d} className={cls || undefined}>
                  <th scope="row" className="day-cell">
                    <Link
                      to={`/day/${d}`}
                      aria-label={dayLong(d)}
                      aria-current={d === today ? 'date' : undefined}
                      tabIndex={-1}
                    >
                      <span className="day-num">{Number(d.slice(8))}</span>
                      <span className="day-wd">{weekdayShort(d)}</span>
                    </Link>
                    {/* V1.1: life-event marker (MON-6). */}
                  </th>
                  {habits.map((h, col) => {
                    const values = valuesByHabit.get(h.id) ?? EMPTY;
                    const value = values.get(d);
                    const isActive = active.row === row && active.col === col;
                    const isEditing = editing?.pos.row === row && editing.pos.col === col;
                    return (
                      <MonthCell
                        key={h.id}
                        habit={h}
                        date={d}
                        row={row}
                        col={col}
                        value={value}
                        active={isActiveOn(h, d)}
                        future={d > today}
                        scheduled={isScheduled(h, d)}
                        rest={isRestDay(h, d)}
                        dayTarget={
                          value !== undefined && h.target?.period === 'day'
                            ? evaluateTarget(h, values, d, week_start)?.status
                            : undefined
                        }
                        color={colors.get(h.categoryId ?? '')}
                        tabStop={isActive}
                        editing={isEditing ? (editing.initial ?? null) : undefined}
                      />
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="day-cell summary-head">
                Month
              </th>
              {habits.map((h) => {
                const s = computeStats(h, valuesByHabit.get(h.id) ?? EMPTY, range, {
                  weekStart: week_start,
                  today,
                });
                const lines = summaryLines(
                  h,
                  s,
                  undefined,
                  restDaysLogged(h, valuesByHabit.get(h.id) ?? EMPTY, range),
                );
                return (
                  <td key={h.id} className="summary-cell" aria-label={`${h.name}: ${lines.label}`}>
                    <span className="summary-main">{lines.main}</span>
                    {lines.sub && <span className="summary-sub">{lines.sub}</span>}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </Actions.Provider>
  );
}

interface CellProps {
  habit: Habit;
  date: ISODate;
  row: number;
  col: number;
  value: number | undefined;
  /** Between the habit's start and end dates. */
  active: boolean;
  /** After the logical today: can't be logged yet. */
  future: boolean;
  scheduled: boolean;
  /** A rest day (HAB-5): shouldn't be done. Still loggable, but flagged when done. */
  rest: boolean;
  dayTarget?: TargetStatus;
  color?: string;
  /** The grid's single tab stop (roving tabindex). */
  tabStop: boolean;
  /** undefined = not editing; null = editing the current value; string = editing, starting with this text. */
  editing: string | null | undefined;
}

/** Spoken value of a cell, e.g. "done", "1 hour 30 minutes" → "1h 30m", "not logged". */
const spoken = (habit: Habit, value: number | undefined) =>
  value === undefined
    ? 'not logged'
    : habit.type === 'boolean'
      ? value === 1
        ? 'done'
        : 'not done'
      : formatValue(habit, value);

/** One (habit, day) cell: value, tint (MON-6), editing (MON-3) and its accessible label (NFR-7). */
const MonthCell = memo(function MonthCell(p: CellProps) {
  const { habit, date, value } = p;
  const actions = useActions();
  const isBool = habit.type === 'boolean';
  const tinted = value !== undefined && !(isBool && value === 0);
  const pos = { row: p.row, col: p.col };

  const cls = [
    'cell',
    tinted && 'logged',
    isBool && value === 1 && 'done',
    !p.active ? 'inactive' : p.rest ? 'rest' : !p.scheduled && 'unscheduled',
    p.rest && tinted && 'rest-broken',
    p.future && 'future',
    p.dayTarget === 'met' && 'target-met',
    p.dayTarget === 'not_met' && 'target-missed',
    p.editing !== undefined && 'editing',
  ]
    .filter(Boolean)
    .join(' ');

  // Future days and days outside the habit's start/end dates can't be logged (ENT-2):
  // stats ignore them, and nobody can have done tomorrow's workout yet.
  const locked = p.future || !p.active;
  const label = `${habit.name}, ${dayLong(date)}: ${
    p.future ? 'not yet' : !p.active ? 'outside the habit’s dates' : spoken(habit, value)
  }${locked || p.scheduled ? '' : !p.rest ? ', not scheduled' : tinted ? ', on a rest day' : ', rest day'}`;

  const toggle = () => actions.commit(habit, date, value === 1 ? undefined : 1);

  const onKeyDown = (e: KeyboardEvent) => {
    if (locked || p.editing !== undefined || e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    if (k === 'Delete' || k === 'Backspace') {
      if (value !== undefined) actions.commit(habit, date, undefined);
    } else if (k === 'Enter' || k === ' ' || k === 'F2') {
      if (isBool) toggle();
      else actions.startEdit(pos);
    } else if (/^\d$/.test(k)) {
      if (isBool) {
        if (k === '1' || k === '0') actions.commit(habit, date, Number(k));
        else return;
      } else if (habit.type === 'rating') {
        const { min, max } = habit.ratingScale ?? { min: 1, max: 10 };
        const v = k === '0' && max >= 10 && min <= 10 ? 10 : Number(k);
        if (max - min + 1 > 11) actions.startEdit(pos, k);
        else if (v >= min && v <= max) actions.commit(habit, date, v);
        else return;
      } else actions.startEdit(pos, k);
    } else if (k === '.' && habit.type === 'number') {
      actions.startEdit(pos, '0.');
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const text =
    value === undefined
      ? p.rest && p.active
        ? '–'
        : ''
      : isBool
        ? value === 1
          ? '✓'
          : '✗'
        : formatValue(habit, value, { compact: true });

  return (
    <td
      role="gridcell"
      data-pos={`${p.row}:${p.col}`}
      tabIndex={p.tabStop ? 0 : -1}
      aria-label={label}
      aria-disabled={locked || undefined}
      className={cls}
      style={tinted ? ({ '--cat': p.color ?? 'var(--accent)' } as CSSProperties) : undefined}
      onClick={() => {
        if (p.editing !== undefined) return;
        actions.focus(pos);
        if (locked) return;
        if (isBool) toggle();
        else actions.startEdit(pos);
      }}
      onKeyDown={onKeyDown}
    >
      <span aria-hidden>{text}</span>
      {p.editing !== undefined && <CellEditor habit={habit} date={date} value={value} initial={p.editing} />}
    </td>
  );
});

/**
 * The small in-cell editor (MON-3). Enter saves and moves down a day (fill a column like a
 * notebook), Tab saves and moves right, Escape cancels, clicking away saves.
 */
function CellEditor({
  habit,
  date,
  value,
  initial,
}: {
  habit: Habit;
  date: ISODate;
  value: number | undefined;
  initial: string | null;
}) {
  const actions = useActions();
  const done = useRef(false);
  const finish = (move: Move, next?: number | undefined | 'keep') => {
    if (done.current) return;
    done.current = true;
    if (next !== 'keep' && next !== value) actions.commit(habit, date, next);
    actions.endEdit(move);
  };

  const scale = habit.ratingScale ?? { min: 1, max: 10 };
  if (habit.type === 'rating' && initial === null && scale.max - scale.min + 1 <= 11) {
    return (
      <div
        className="cell-editor popover"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape' || e.key === 'Enter') finish('stay', 'keep');
          else if (e.key === 'Tab') {
            e.preventDefault();
            finish('right', 'keep');
          }
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) finish('stay', 'keep');
        }}
      >
        <RatingPicker
          habit={habit}
          value={value}
          label={`${habit.name}, ${dayLong(date)}`}
          onChange={(v) => finish('stay', v)}
        />
        <AutoFocusFirst />
      </div>
    );
  }

  return <TextCellEditor habit={habit} value={value} initial={initial} onFinish={finish} date={date} />;
}

/** Focuses the checked (or first) radio of the rating picker it is rendered next to. */
function AutoFocusFirst() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const box = ref.current?.parentElement;
    (
      box?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]') ??
      box?.querySelector<HTMLElement>('[role="radio"]')
    )?.focus();
  }, []);
  return <span ref={ref} hidden />;
}

function TextCellEditor({
  habit,
  value,
  initial,
  date,
  onFinish,
}: {
  habit: Habit;
  value: number | undefined;
  initial: string | null;
  date: ISODate;
  onFinish(move: Move, next?: number | undefined | 'keep'): void;
}) {
  const current =
    value === undefined ? '' : habit.type === 'duration' ? formatDuration(value) : String(value);
  const [text, setText] = useState(initial ?? current);
  const [invalid, setInvalid] = useState(false);

  const parse = (s: string): number | undefined | null => {
    if (!s.trim()) return undefined;
    if (habit.type === 'duration') return parseDuration(s);
    const n = parseNumber(s);
    if (n === null || n === undefined) return n ?? null;
    if (habit.type === 'rating') {
      const { min, max } = habit.ratingScale ?? { min: 1, max: 10 };
      return Number.isInteger(n) && n >= min && n <= max ? n : null;
    }
    return n;
  };

  const save = (move: Move) => {
    const v = parse(text);
    if (v === null) {
      setInvalid(true);
      return false;
    }
    onFinish(move, v);
    return true;
  };

  return (
    <div className="cell-editor" onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus
        aria-label={`${habit.name}, ${dayLong(date)}`}
        aria-invalid={invalid || undefined}
        inputMode={habit.type === 'duration' ? 'text' : 'decimal'}
        value={text}
        onFocus={(e) => initial === null && e.currentTarget.select()}
        onChange={(e) => {
          setText(e.target.value);
          setInvalid(false);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            save('down');
          } else if (e.key === 'Tab') {
            e.preventDefault();
            save('right');
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onFinish('stay', 'keep');
          }
        }}
        onBlur={() => {
          if (!save('stay')) onFinish('stay', 'keep');
        }}
      />
    </div>
  );
}
