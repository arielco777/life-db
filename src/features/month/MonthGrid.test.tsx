// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { MonthRoute } from './MonthPage';
import { renderWithApp } from '../../../tests/render';
import { logicalToday } from '@/domain/services/clock';
import { addDays, addMonths, monthOf } from '@/domain/services/dates';

const AUG = '2026-08';
const S = '2026-01-01';

/** Exercise (boolean), Sleep (number h), Reading (duration), Mood (rating 1–10). */
async function open() {
  const ids: Record<string, string> = {};
  const app = await renderWithApp(
    async ({ repos }) => {
      ids.ex = (await repos.habits.create({ name: 'Exercise', type: 'boolean', startDate: S })).id;
      ids.sl = (await repos.habits.create({ name: 'Sleep', type: 'number', unit: 'h', startDate: S })).id;
      ids.rd = (await repos.habits.create({ name: 'Reading', type: 'duration', startDate: S })).id;
      ids.md = (await repos.habits.create({ name: 'Mood', type: 'rating', startDate: S })).id;
      return (
        <Routes>
          <Route path="/month/:ym?" element={<MonthRoute />} />
        </Routes>
      );
    },
    { route: `/month/${AUG}` },
  );
  await screen.findByRole('grid');
  const value = async (id: string, day: number) =>
    (await app.repos.entries.get(id, `2026-08-${String(day).padStart(2, '0')}`))?.value;
  return { ...app, ids, value };
}

/** Tab from the month header controls into the grid's single tab stop. */
async function tabIntoGrid(user: { tab(): Promise<void> }) {
  for (let i = 0; i < 10 && !document.activeElement?.closest('[role="grid"]'); i++) await user.tab();
}

const cell = (day: number, col: number) => {
  const rows = within(screen.getByRole('grid')).getAllByRole('row');
  return within(rows[day]!).getAllByRole('gridcell')[col]!;
};

describe('Monthly grid editing (tasks 6.4, MON-3)', () => {
  it('clicking a checkbox cell toggles done ↔ not logged', async () => {
    const app = await open();
    await app.user.click(cell(3, 0));
    expect(cell(3, 0)).toHaveTextContent('✓');
    await waitFor(async () => expect(await app.value(app.ids.ex!, 3)).toBe(1));
    await app.user.click(cell(3, 0));
    await waitFor(async () => expect(await app.value(app.ids.ex!, 3)).toBeUndefined());
    expect(cell(3, 0)).toHaveAccessibleName('Exercise, Monday, August 3: not logged');
  });

  it('is one tab stop; arrows move by day and habit', async () => {
    const app = await open();
    await tabIntoGrid(app.user);
    expect(cell(1, 0)).toHaveFocus(); // August is past: starts on day 1
    await app.user.keyboard('{ArrowDown}{ArrowDown}{ArrowRight}');
    expect(cell(3, 1)).toHaveFocus();
    await app.user.keyboard('{End}');
    expect(cell(3, 3)).toHaveFocus();
    await app.user.keyboard('{PageDown}{Home}');
    expect(cell(10, 0)).toHaveFocus();
    await app.user.keyboard('{ArrowUp}'.repeat(20));
    expect(cell(1, 0)).toHaveFocus();
    await app.user.tab();
    expect(document.activeElement?.closest('[role="grid"]')).toBeNull(); // Tab leaves the grid
  });

  it('keyboard on checkbox cells: Space/Enter toggle, 0 = not done, Delete clears', async () => {
    const app = await open();
    await tabIntoGrid(app.user);
    await app.user.keyboard(' ');
    await waitFor(async () => expect(await app.value(app.ids.ex!, 1)).toBe(1));
    await app.user.keyboard('{ArrowDown}0');
    await waitFor(async () => expect(await app.value(app.ids.ex!, 2)).toBe(0));
    expect(cell(2, 0)).toHaveTextContent('✗');
    await app.user.keyboard('{Delete}');
    await waitFor(async () => expect(await app.value(app.ids.ex!, 2)).toBeUndefined());
  });

  it('typing a digit starts editing; Enter saves and moves down a day (fill a column)', async () => {
    const app = await open();
    await tabIntoGrid(app.user);
    await app.user.keyboard('{ArrowRight}7.5{Enter}');
    await waitFor(async () => expect(await app.value(app.ids.sl!, 1)).toBe(7.5));
    expect(cell(1, 1)).toHaveTextContent('7.5');
    expect(cell(2, 1)).toHaveFocus();
    await app.user.keyboard('8{Enter}6.25{Enter}');
    await waitFor(async () => expect(await app.value(app.ids.sl!, 3)).toBe(6.25));
    expect(await app.value(app.ids.sl!, 2)).toBe(8);
  });

  it('durations accept 45, 0:45 or 1h30; Tab saves and moves right', async () => {
    const app = await open();
    await app.user.click(cell(5, 2));
    const input = within(cell(5, 2)).getByRole('textbox', { name: 'Reading, Wednesday, August 5' });
    await app.user.type(input, '1h30{Tab}');
    await waitFor(async () => expect(await app.value(app.ids.rd!, 5)).toBe(90));
    expect(cell(5, 2)).toHaveTextContent('1h30');
    expect(cell(5, 3)).toHaveFocus();
  });

  it('Escape cancels; invalid text is flagged and not saved', async () => {
    const app = await open();
    await app.user.click(cell(4, 1));
    let input = within(cell(4, 1)).getByRole('textbox');
    await app.user.type(input, '9{Escape}');
    expect(within(cell(4, 1)).queryByRole('textbox')).not.toBeInTheDocument();
    expect(cell(4, 1)).toHaveFocus();
    expect(await app.value(app.ids.sl!, 4)).toBeUndefined();

    await app.user.keyboard('{Enter}');
    input = within(cell(4, 1)).getByRole('textbox');
    await app.user.type(input, 'abc{Enter}');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await app.user.keyboard('{Escape}');
    expect(await app.value(app.ids.sl!, 4)).toBeUndefined();
  });

  it('editing an existing value starts from it; emptying the field clears it', async () => {
    const app = await open();
    await app.repos.entries.set(app.ids.rd!, '2026-08-06', 45);
    await app.queryClient.invalidateQueries();
    await waitFor(() => expect(cell(6, 2)).toHaveTextContent('45m'));
    await app.user.click(cell(6, 2));
    const input = within(cell(6, 2)).getByRole('textbox');
    expect(input).toHaveValue('45m');
    await app.user.clear(input);
    await app.user.keyboard('{Enter}');
    await waitFor(async () => expect(await app.value(app.ids.rd!, 6)).toBeUndefined());
  });

  it('ratings: a digit sets the value directly; Enter opens the picker', async () => {
    const app = await open();
    await tabIntoGrid(app.user);
    await app.user.keyboard('{End}8');
    await waitFor(async () => expect(await app.value(app.ids.md!, 1)).toBe(8));
    await app.user.keyboard('{ArrowDown}0');
    await waitFor(async () => expect(await app.value(app.ids.md!, 2)).toBe(10));

    await app.user.keyboard('{ArrowDown}{Enter}');
    const picker = within(cell(3, 3)).getByRole('radiogroup', { name: 'Mood, Monday, August 3' });
    await app.user.click(within(picker).getByRole('radio', { name: '6' }));
    await waitFor(async () => expect(await app.value(app.ids.md!, 3)).toBe(6));
    expect(within(cell(3, 3)).queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(cell(3, 3)).toHaveFocus();
  });

  it('the summary row follows edits', async () => {
    const app = await open();
    const summary = () =>
      screen.getByRole('rowheader', { name: 'Month' }).closest('tr')!.querySelectorAll('td');
    expect(summary()[0]).toHaveTextContent('0/31');
    await app.user.click(cell(1, 0));
    await app.user.click(cell(2, 0));
    await waitFor(() => expect(summary()[0]).toHaveTextContent('2/31'));
  });
});

describe('Days that can’t be logged (ENT-2)', () => {
  it('future days are read-only: no toggle, no editor, no digits', async () => {
    const next = addMonths(monthOf(logicalToday(4)), 1);
    let id = '';
    const app = await renderWithApp(
      async ({ repos }) => {
        id = (await repos.habits.create({ name: 'Exercise', type: 'boolean', startDate: S })).id;
        await repos.habits.create({ name: 'Sleep', type: 'number', startDate: S });
        return (
          <Routes>
            <Route path="/month/:ym?" element={<MonthRoute />} />
          </Routes>
        );
      },
      { route: `/month/${next}` },
    );
    await screen.findByRole('grid');
    expect(cell(1, 0)).toHaveAttribute('aria-disabled', 'true');
    expect(cell(1, 0)).toHaveAccessibleName(expect.stringMatching(/: not yet$/));
    await app.user.click(cell(1, 0));
    expect(cell(1, 0)).toHaveTextContent('');
    expect(cell(1, 0)).toHaveFocus(); // still reachable for navigation
    await app.user.keyboard(' 1');
    await app.user.click(cell(1, 1));
    expect(within(cell(1, 1)).queryByRole('textbox')).not.toBeInTheDocument();
    await app.user.keyboard('7');
    expect(within(cell(1, 1)).queryByRole('textbox')).not.toBeInTheDocument();
    expect(await app.repos.entries.forRange({ from: `${next}-01`, to: `${next}-31` })).toEqual([]);
    expect(id).not.toBe('');
  });

  it('today is editable, tomorrow is not', async () => {
    const today = logicalToday(4);
    const app = await renderWithApp(
      async ({ repos }) => {
        await repos.habits.create({ name: 'Exercise', type: 'boolean', startDate: S });
        return (
          <Routes>
            <Route path="/month/:ym?" element={<MonthRoute />} />
          </Routes>
        );
      },
      { route: `/month/${monthOf(today)}` },
    );
    await screen.findByRole('grid');
    const day = Number(today.slice(8));
    expect(cell(day, 0)).not.toHaveAttribute('aria-disabled');
    if (monthOf(addDays(today, 1)) === monthOf(today))
      expect(cell(day + 1, 0)).toHaveAttribute('aria-disabled', 'true');
    await app.user.click(cell(day, 0));
    expect(cell(day, 0)).toHaveTextContent('✓');
  });

  it('days before a habit started are read-only', async () => {
    const app = await renderWithApp(
      async ({ repos }) => {
        await repos.habits.create({ name: 'Late', type: 'boolean', startDate: '2026-08-10' });
        return (
          <Routes>
            <Route path="/month/:ym?" element={<MonthRoute />} />
          </Routes>
        );
      },
      { route: `/month/${AUG}` },
    );
    await screen.findByRole('grid');
    expect(cell(9, 0)).toHaveAttribute('aria-disabled', 'true');
    expect(cell(9, 0)).toHaveAccessibleName(expect.stringMatching(/outside the habit’s dates$/));
    await app.user.click(cell(9, 0));
    expect(cell(9, 0)).toHaveTextContent('');
    await app.user.click(cell(10, 0));
    expect(cell(10, 0)).toHaveTextContent('✓');
  });
});
