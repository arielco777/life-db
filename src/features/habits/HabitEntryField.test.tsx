// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { entryKeys } from './entryHooks';
import { HabitEntryField } from './HabitEntryField';
import { renderWithApp } from '../../../tests/render';
import type { Habit, HabitType } from '@/domain/types';

const DATE = '2026-08-14';
const WEEK = { from: '2026-08-10', to: '2026-08-16' };

async function open(type: HabitType, opts: { range?: typeof WEEK } = {}) {
  let habit!: Habit;
  const app = await renderWithApp(async ({ repos }) => {
    habit = await repos.habits.create({ name: 'Sleep', type, startDate: '2026-01-01' });
    return <Field habit={habit} range={opts.range} />;
  });
  return { ...app, habit };
}

function Field({ habit, range }: { habit: Habit; range?: typeof WEEK }) {
  return <HabitEntryField habit={habit} date={DATE} label="Sleep, August 14" range={range} />;
}

describe('HabitEntryField (ENT-1…5, design §6.1)', () => {
  it('saves instantly and shows the value before the save completes', async () => {
    const app = await open('number');
    const input = await screen.findByRole('textbox', { name: 'Sleep, August 14' });
    await waitFor(() => expect(input).toBeEnabled());
    await app.user.type(input, '7.5{Enter}');
    expect(input).toHaveValue('7.5');
    await waitFor(async () => expect((await app.repos.entries.get(app.habit.id, DATE))?.value).toBe(7.5));
  });

  it('patches every cached window that covers the date', async () => {
    const app = await open('boolean', { range: WEEK });
    await app.queryClient.fetchQuery({
      queryKey: entryKeys.range({ from: '2026-08-01', to: '2026-08-31' }),
      queryFn: () => app.repos.entries.forRange({ from: '2026-08-01', to: '2026-08-31' }),
    });
    const box = await screen.findByRole('checkbox', { name: 'Sleep, August 14' });
    await waitFor(() => expect(box).toBeEnabled());
    await app.user.click(box);
    const month = app.queryClient.getQueryData<{ value: number }[]>(
      entryKeys.range({ from: '2026-08-01', to: '2026-08-31' }),
    );
    expect(month?.map((e) => e.value)).toEqual([1]);
    expect(box).toBeChecked();
  });

  it('clearing removes the entry; logging again reuses its ID (ENT-1, ENT-2)', async () => {
    const app = await open('rating');
    await app.repos.entries.set(app.habit.id, DATE, 6);
    const first = (await app.repos.entries.get(app.habit.id, DATE))!.id;
    await app.queryClient.invalidateQueries();
    const six = await screen.findByRole('radio', { name: '6' });
    await waitFor(() => expect(six).toBeChecked());
    await app.user.click(six);
    await waitFor(async () => expect(await app.repos.entries.get(app.habit.id, DATE)).toBeNull());
    await app.user.click(screen.getByRole('radio', { name: '8' }));
    await waitFor(async () => expect((await app.repos.entries.get(app.habit.id, DATE))?.id).toBe(first));
  });

  it('rolls back and shows a toast when saving fails', async () => {
    const app = await open('number');
    const input = await screen.findByRole('textbox');
    await waitFor(() => expect(input).toBeEnabled());
    await app.repos.habits.remove(app.habit.id); // the save will now fail with "not found"
    await app.user.type(input, '3{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Habit not found');
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('notes: disabled until logged, saved on close, shown on the button (ENT-3)', async () => {
    const app = await open('boolean');
    const menu = await screen.findByRole('button', { name: 'Sleep, August 14: note and options' });
    await app.user.click(menu);
    expect(screen.getByPlaceholderText('Log a value first')).toBeDisabled();
    await app.user.keyboard('{Escape}');
    expect(menu).toHaveFocus();

    await app.user.click(screen.getByRole('checkbox'));
    await app.user.click(menu);
    await app.user.type(screen.getByPlaceholderText('Add a note…'), 'felt great');
    await app.user.keyboard('{Escape}');
    await waitFor(async () =>
      expect((await app.repos.entries.get(app.habit.id, DATE))?.note).toBe('felt great'),
    );
    expect(
      await screen.findByRole('button', { name: 'Sleep, August 14: note and options (has note)' }),
    ).toBeInTheDocument();
    // Changing the value keeps the note.
    await app.user.click(screen.getByRole('checkbox'));
    await app.user.click(screen.getByRole('checkbox'));
    await waitFor(async () => expect((await app.repos.entries.get(app.habit.id, DATE))?.value).toBe(1));
  });

  it('"Mark not done" logs 0, distinct from not logged; "Clear entry" removes it', async () => {
    const app = await open('boolean');
    const menu = await screen.findByRole('button', { name: /note and options/ });
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled());
    await app.user.click(menu);
    await app.user.click(screen.getByRole('button', { name: 'Mark not done' }));
    expect(
      await screen.findByRole('checkbox', { name: 'Sleep, August 14 (marked not done)' }),
    ).toBeInTheDocument();
    await waitFor(async () => expect((await app.repos.entries.get(app.habit.id, DATE))?.value).toBe(0));

    await app.user.click(menu);
    const group = screen.getByRole('group', { name: 'Sleep, August 14 options' });
    expect(within(group).queryByRole('button', { name: 'Mark not done' })).not.toBeInTheDocument();
    await app.user.click(within(group).getByRole('button', { name: 'Clear entry' }));
    await waitFor(async () => expect(await app.repos.entries.get(app.habit.id, DATE)).toBeNull());
    expect(screen.getByRole('checkbox', { name: 'Sleep, August 14' })).not.toBeChecked();
  });

  it('clicking outside the menu closes it', async () => {
    const app = await open('number');
    await app.user.click(await screen.findByRole('button', { name: /note and options/ }));
    expect(screen.getByRole('group')).toBeInTheDocument();
    await app.user.click(document.body);
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });
});
