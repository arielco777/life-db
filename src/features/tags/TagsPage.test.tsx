// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithApp } from '../../../tests/render';
import { SettingsPage } from '@/features/settings/SettingsPage';

const Settings = () => (
  <Routes>
    <Route path="/settings/*" element={<SettingsPage />} />
  </Routes>
);

/** Renders Settings at /settings/tags with a few tagged records. */
async function open() {
  const app = await renderWithApp(<Settings />, { route: '/settings/tags' });
  const { repos } = app;
  const money = await repos.tags.getOrCreate('money');
  const finance = await repos.tags.getOrCreate('finance');
  const unused = await repos.tags.getOrCreate('unused');
  const run = await repos.habits.create({ name: 'Run', type: 'boolean', tagIds: [money.id] });
  await repos.habits.create({ name: 'Budget', type: 'boolean', tagIds: [finance.id] });
  await repos.journal.create({ entryDate: '2026-08-14', title: 'Paid rent', tagIds: [money.id, finance.id] });
  await repos.journal.create({ entryDate: '2026-08-20', body: '\nBought a bike\nmore', tagIds: [money.id] });
  await app.queryClient.invalidateQueries();
  const list = await screen.findByRole('list', { name: 'Tags' });
  await within(list).findByText('#money');
  await within(list).findByText('3 records');
  return { ...app, list, money, finance, unused, run };
}

const rowOf = (list: HTMLElement, name: string) => within(list).getByText(`#${name}`).closest('li')!;

describe('TagsPage (tasks 3.4)', () => {
  it('shows an empty state with no tags', async () => {
    await renderWithApp(<Settings />, { route: '/settings/tags' });
    expect(await screen.findByText(/No tags yet/)).toBeInTheDocument();
  });

  it('lists tags alphabetically with usage counts', async () => {
    const { list } = await open();
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((r) => within(r).getByRole('link').textContent)).toEqual([
      '#finance',
      '#money',
      '#unused',
    ]);
    expect(rowOf(list, 'finance')).toHaveTextContent('2 records');
    expect(rowOf(list, 'unused')).toHaveTextContent('0 records');
  });

  it('renames, normalizing the name (TAG-3, TAG-4)', async () => {
    const { user, list, repos, money } = await open();
    await user.click(within(list).getByRole('button', { name: 'Rename money' }));
    const input = within(list).getByLabelText('Tag name');
    await user.clear(input);
    await user.type(input, '  Cash {Enter}');
    await within(list).findByText('#cash');
    expect((await repos.tags.get(money.id))?.name).toBe('cash');
  });

  it('rename to an existing name explains to merge instead', async () => {
    const { user, list } = await open();
    await user.click(within(list).getByRole('button', { name: 'Rename money' }));
    const input = within(list).getByLabelText('Tag name');
    await user.clear(input);
    await user.type(input, 'finance{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Merge them instead');
    expect(within(list).getByLabelText('Tag name')).toBeInTheDocument();
  });

  it('merges after confirmation (TAG-4)', async () => {
    const { user, list, repos, finance, money } = await open();
    await user.click(within(list).getByRole('button', { name: 'Merge finance' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Merge #finance' });
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.selectOptions(within(dialog).getByLabelText('Merge into'), '#money');
    expect(dialog).toHaveTextContent('2 records tagged #finance will be tagged #money instead');
    await user.click(within(dialog).getByRole('button', { name: 'Merge' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await waitFor(() => expect(within(list).queryByText('#finance')).not.toBeInTheDocument());
    expect(await repos.tags.get(finance.id)).toBeNull();
    // Paid rent had both tags; it now carries money once. Budget moved over.
    expect((await repos.tags.usageCounts()).get(money.id)).toBe(4);
    await within(list).findByText('4 records');
  });

  it('cancel and Escape leave everything as is', async () => {
    const { user, list, repos } = await open();
    await user.click(within(list).getByRole('button', { name: 'Delete money' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: 'Delete money' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(await repos.tags.list()).toHaveLength(3);
  });

  it('deletes after confirmation, keeping the records', async () => {
    const { user, list, repos, money, run } = await open();
    await user.click(within(list).getByRole('button', { name: 'Delete money' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete #money' });
    expect(dialog).toHaveTextContent('removed from 3 records');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(within(list).queryByText('#money')).not.toBeInTheDocument());
    expect(await repos.tags.get(money.id)).toBeNull();
    expect((await repos.habits.get(run.id))?.tagIds).toEqual([]);
  });
});

describe('TagView (TAG-5)', () => {
  it('lists the habits and journal entries carrying a tag', async () => {
    const { user, list } = await open();
    await user.click(within(list).getByRole('link', { name: '#money' }));
    expect(await screen.findByRole('heading', { name: '#money' })).toBeInTheDocument();

    const habits = await screen.findByRole('list', { name: 'Habits' });
    expect(within(habits).getByRole('link', { name: 'Run' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/habits\//),
    );
    const journal = screen.getByRole('list', { name: 'Journal entries' });
    // Newest first; untitled entries use their first non-empty line.
    expect(
      within(journal)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Bought a bike', 'Paid rent']);

    await user.click(screen.getByRole('link', { name: '← All tags' }));
    expect(await screen.findByRole('list', { name: 'Tags' })).toBeInTheDocument();
  });

  it('shows an empty state for an unused tag, and handles a missing tag', async () => {
    const { user, list } = await open();
    await user.click(within(list).getByRole('link', { name: '#unused' }));
    expect(await screen.findByText('Nothing carries this tag yet.')).toBeInTheDocument();

    await renderWithApp(<Settings />, { route: '/settings/tags/does-not-exist' });
    expect(await screen.findByText('This tag no longer exists.')).toBeInTheDocument();
  });
});
