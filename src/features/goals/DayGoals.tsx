import { Link } from 'react-router-dom';
import { useGoals } from './hooks';
import { ProgressBar } from './ProgressBar';
import { formatValue } from '@/domain/services/format';
import { isDoneValue, isRestDay, isScheduled } from '@/domain/services/schedule';
import type { ValuesByDate } from '@/domain/services/targets';
import type { Habit, ISODate, UUID } from '@/domain/types';

/** How a linked habit stands on the day, in words: its value, or why there isn't one. */
function habitStatus(habit: Habit, value: number | undefined, date: ISODate) {
  if (value !== undefined) return { text: formatValue(habit, value), done: isDoneValue(habit, value) };
  if (isRestDay(habit, date)) return { text: 'Rest day', done: false };
  if (!isScheduled(habit, date)) return { text: 'Not scheduled', done: false };
  return { text: 'Not logged', done: false };
}

/**
 * The daily view's goals section (tasks 11.8, DAY-1 §4, GOAL-5): active goals that have
 * habits on this day, with each habit's status for the day. Habits are logged in the
 * habits section above, so this only reports.
 */
export function DayGoals({
  date,
  habits,
  valuesByHabit,
}: {
  date: ISODate;
  habits: Habit[];
  valuesByHabit: ReadonlyMap<UUID, ValuesByDate>;
}) {
  const { data: goals = [] } = useGoals();
  const onDay = new Map(habits.map((h) => [h.id, h]));
  const shown = goals
    .filter((g) => g.status === 'active')
    .map((g) => ({ goal: g, habits: g.habitIds.map((id) => onDay.get(id)).filter((h): h is Habit => !!h) }))
    .filter((x) => x.habits.length > 0);
  if (shown.length === 0) return null;

  return (
    <section className="day-section" aria-labelledby="day-goals">
      <h2 id="day-goals" className="section-title">
        Goals
      </h2>
      <ul className="plain list" aria-label="Goals">
        {shown.map(({ goal, habits: linked }) => (
          <li key={goal.id} className="list-row goal-row">
            <span className="grow stack-xs">
              <Link to={`/goals/${goal.id}`} className="habit-name">
                {goal.title}
              </Link>
              <ul className="plain small goal-habits" aria-label={`Habits for ${goal.title}`}>
                {linked.map((h) => {
                  const s = habitStatus(h, valuesByHabit.get(h.id)?.get(date), date);
                  return (
                    <li key={h.id} className={s.done ? undefined : 'muted'}>
                      {h.name}: {s.text}
                    </li>
                  );
                })}
              </ul>
            </span>
            <ProgressBar goal={goal} label={`${goal.title} progress`} />
          </li>
        ))}
      </ul>
    </section>
  );
}
