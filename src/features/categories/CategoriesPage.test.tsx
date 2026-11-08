// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { CategoriesPage } from './CategoriesPage';
import { renderWithApp } from '../../../tests/render';
import { DEFAULT_CATEGORY_IDS } from '@/domain/ids';

const names = (list: HTMLElement) =>
  within(list)
    .getAllByRole('listitem')
    .map((li) => li.textContent?.replace(/↑↓EditArchive$/, ''));

async function open() {
  const app = await renderWithApp(<CategoriesPage />);
  const list = await screen.findByRole('list', { name: 'Categories' });
  await within(list).findByText('Health');
  return { ...app, list };
}

describe('CategoriesPage (tasks 3.1)', () => {
  it('lists the seeded categories in order', async () => {
    const { list } = await open();
    expect(names(list)).toEqual([
      'Health',
      'Work',
      'Money',
      'Learning',
      'Relationships',
      'Home',
      'Personal',
      'Leisure',
    ]);
  });

  it('creates a category with the first unused palette color', async () => {
    const { user, list, repos } = await open();
    await user.type(screen.getByLabelText('New category name'), 'Fitness{Enter}');
    await within(list).findByText('Fitness');
    const created = (await repos.categories.list()).find((c) => c.name === 'Fitness');
    expect(created?.color).toBe('#b5524a'); // first eight are taken by the defaults
    expect(screen.getByLabelText('New category name')).toHaveValue('');
  });

  it('shows a toast for a duplicate name, case-insensitively (CAT-4)', async () => {
    const { user } = await open();
    await user.type(screen.getByLabelText('New category name'), 'health{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('A category named "health" already exists');
    expect(screen.getByLabelText('New category name')).toHaveValue('health');
  });

  it('renames and recolors', async () => {
    const { user, list, repos } = await open();
    await user.click(within(list).getByRole('button', { name: 'Edit Work' }));
    const input = within(list).getByLabelText('Category name');
    await user.clear(input);
    await user.type(input, 'Career');
    await user.click(within(list).getByRole('radio', { name: 'Red' }));
    await user.click(within(list).getByRole('button', { name: 'Save' }));
    await within(list).findByText('Career');
    expect(await repos.categories.get(DEFAULT_CATEGORY_IDS.work)).toMatchObject({
      name: 'Career',
      color: '#b5524a',
    });
  });

  it('Escape cancels an edit', async () => {
    const { user, list } = await open();
    await user.click(within(list).getByRole('button', { name: 'Edit Work' }));
    await user.type(within(list).getByLabelText('Category name'), 'xyz{Escape}');
    expect(within(list).queryByLabelText('Category name')).not.toBeInTheDocument();
    expect(within(list).getByText('Work')).toBeInTheDocument();
  });

  it('archives and restores', async () => {
    const { user, list, repos } = await open();
    await user.click(within(list).getByRole('button', { name: 'Archive Money' }));
    await waitFor(() => expect(within(list).queryByText('Money')).not.toBeInTheDocument());
    expect((await repos.categories.list()).map((c) => c.name)).not.toContain('Money');

    await user.click(screen.getByText('Archived (1)'));
    await user.click(screen.getByRole('button', { name: 'Restore Money' }));
    await within(list).findByText('Money');
    expect(screen.queryByText(/Archived \(/)).not.toBeInTheDocument();
  });

  it('reorders with the move buttons', async () => {
    const { user, list, repos } = await open();
    expect(within(list).getByRole('button', { name: 'Move Health up' })).toBeDisabled();
    expect(within(list).getByRole('button', { name: 'Move Leisure down' })).toBeDisabled();
    await user.click(within(list).getByRole('button', { name: 'Move Work up' }));
    await waitFor(() => expect(names(list).slice(0, 2)).toEqual(['Work', 'Health']));
    await waitFor(async () =>
      expect((await repos.categories.list()).slice(0, 2).map((c) => c.name)).toEqual(['Work', 'Health']),
    );
  });
});
