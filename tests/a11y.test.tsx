// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { renderWithApp } from './render';
import { App } from '@/app/App';
import { DEFAULT_CATEGORY_IDS } from '@/domain/ids';
import type { UUID } from '@/domain/types';

/**
 * axe over every main screen (NFR-7, task 9.4): names, labels, roles, ARIA use, landmarks.
 * Colour contrast needs real rendering, so it's checked on the tokens instead
 * (src/ui/tokens.test.ts).
 */
async function violations() {
  const result = await axe.run(document.body, {
    rules: { 'color-contrast': { enabled: false } },
  });
  return result.violations.map(
    (v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
}

const SLOW = { timeout: 5000 };
let habitId: UUID = '';
let entryId: UUID = '';

const open = (route: string) =>
  renderWithApp(
    async ({ repos }) => {
      await repos.settings.set('onboarding.completed', true);
      const run = await repos.habits.create({
        name: 'Run',
        type: 'duration',
        target: { value: 30, op: 'at_least', period: 'day' },
        categoryId: DEFAULT_CATEGORY_IDS.health,
        startDate: '2026-08-01',
      });
      habitId = run.id;
      await repos.habits.create({ name: 'Stretch', type: 'boolean', startDate: '2026-08-01' });
      await repos.habits.create({ name: 'Water', type: 'number', unit: 'glasses', startDate: '2026-08-01' });
      await repos.habits.create({ name: 'Mood', type: 'rating', startDate: '2026-08-01' });
      await repos.entries.set(run.id, '2026-08-13', 25);
      const tag = await repos.tags.getOrCreate('travel');
      entryId = (
        await repos.journal.create({
          entryDate: '2026-08-13',
          title: 'Trip',
          body: 'Packed',
          tagIds: [tag.id],
        })
      ).id;
      return <App />;
    },
    { route },
  );

describe('Accessibility of every screen (axe)', () => {
  it('catches a real problem (the check itself works)', async () => {
    await renderWithApp(<input type="text" />);
    expect((await violations()).join()).toMatch(/^label:/);
  });

  it.each([
    ['/day/2026-08-13', 'heading'],
    ['/month/2026-08', 'grid'],
    ['/habits', 'heading'],
    ['/habits/new', 'heading'],
    ['/journal', 'heading'],
    ['/journal/new', 'heading'],
    ['/settings/general', 'heading'],
    ['/settings/categories', 'heading'],
    ['/settings/tags', 'heading'],
    ['/settings/data', 'heading'],
    ['/settings/security', 'heading'],
  ])('%s', async (route, role) => {
    await open(route);
    await screen.findAllByRole(role, {}, SLOW);
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument(), SLOW);
    expect(await violations()).toEqual([]);
  });

  it('a habit and a journal entry', async () => {
    const app = await open('/habits');
    await app.user.click(await screen.findByRole('link', { name: /^Run/ }, SLOW));
    await screen.findByRole('heading', { name: 'Run' });
    expect(await violations()).toEqual([]);
    expect(habitId).not.toBe('');

    await app.user.click(screen.getByRole('link', { name: 'Journal' }));
    await app.user.click(await screen.findByRole('link', { name: /^Trip/ }, SLOW));
    await screen.findByRole('textbox', { name: 'Entry' });
    expect(entryId).not.toBe('');
    expect(await violations()).toEqual([]);
  });
});
