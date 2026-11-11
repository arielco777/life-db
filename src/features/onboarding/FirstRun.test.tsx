// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { FirstRunGate } from './FirstRun';
import { renderWithApp } from '../../../tests/render';
import type { setup } from '../../../tests/helpers';

type Ctx = Awaited<ReturnType<typeof setup>>;

const open = (seed?: (ctx: Ctx) => Promise<unknown>) =>
  renderWithApp(async (ctx) => {
    await seed?.(ctx);
    return (
      <FirstRunGate>
        <p>The app</p>
      </FirstRunGate>
    );
  });

describe('First run (task 9.1, SET-1)', () => {
  it('creates the ticked habits and saves the name, then opens the app', async () => {
    const { user, repos } = await open();
    expect(await screen.findByRole('heading', { name: 'Welcome to Life DB' })).toBeInTheDocument();
    expect(screen.queryByText('The app')).not.toBeInTheDocument();
    expect(screen.getAllByRole('checkbox').map((c) => c.closest('label')!.textContent)).toEqual([
      'Exercise · Minutes of exercise',
      'Read · Minutes of reading',
      'Meditate · Done or not',
      'Sleep · How long you slept',
      'Coffee · Cups, at most 3 a day',
      'Mood · A rating from 1 to 10',
    ]);

    await user.type(screen.getByLabelText('What should we call you?'), 'Ariel');
    await user.click(screen.getByRole('checkbox', { name: /Coffee/ }));
    await user.click(screen.getByRole('checkbox', { name: /Mood/ }));
    await user.click(screen.getByRole('button', { name: 'Start with 2 habits' }));

    expect(await screen.findByText('The app')).toBeInTheDocument();
    const habits = await repos.habits.list();
    expect(habits.map((h) => h.name)).toEqual(['Coffee', 'Mood']);
    expect(habits[0]).toMatchObject({ type: 'number', unit: 'cups', target: { value: 3, op: 'at_most' } });
    expect(habits[1]).toMatchObject({ type: 'rating', ratingScale: { min: 1, max: 10 } });
    const settings = await repos.settings.getAll();
    expect(settings['profile.display_name']).toBe('Ariel');
    expect(settings['onboarding.completed']).toBe(true);
  });

  it('Skip opens the app with nothing added, and the welcome never comes back', async () => {
    const { user, repos } = await open();
    await user.type(await screen.findByLabelText('What should we call you?'), 'Ignored');
    await user.click(screen.getByRole('checkbox', { name: /Read/ }));
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(await screen.findByText('The app')).toBeInTheDocument();
    expect(await repos.habits.list()).toHaveLength(0);
    const settings = await repos.settings.getAll();
    expect(settings['onboarding.completed']).toBe(true);
    expect(settings['profile.display_name']).toBe('');
  });

  it('existing data counts as set up: no welcome (users from before onboarding)', async () => {
    const { repos } = await open(async ({ repos }) => {
      await repos.journal.create({ entryDate: '2026-08-01', body: 'Already here' });
    });
    expect(await screen.findByText('The app')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Welcome to Life DB' })).not.toBeInTheDocument();
    await waitFor(async () => expect((await repos.settings.getAll())['onboarding.completed']).toBe(true));
  });
});
