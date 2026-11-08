// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { suggestTags } from './hooks';
import { TagInput } from './TagInput';
import { renderWithApp } from '../../../tests/render';
import type { Tag, UUID } from '@/domain/types';

let latest: UUID[] = [];
function Harness({ initial = [] }: { initial?: UUID[] }) {
  const [ids, setIds] = useState(initial);
  return (
    <TagInput
      aria-label="Tags"
      value={ids}
      onChange={(next) => {
        latest = next;
        setIds(next);
      }}
    />
  );
}

const chips = () =>
  within(screen.getByRole('list', { name: 'Selected tags' }))
    .queryAllByRole('listitem')
    .map((li) => li.textContent?.replace('×', ''));
const options = () => screen.queryAllByRole('option').map((o) => o.textContent);

describe('suggestTags', () => {
  const t = (name: string): Tag => ({ id: name, name, createdAt: '', updatedAt: '' });
  const all = ['health', 'meal', 'money', 'mood', 'summer'].map(t);
  it('ranks prefix matches before inner matches and skips chosen tags', () => {
    expect(suggestTags(all, 'm', []).map((x) => x.name)).toEqual(['meal', 'money', 'mood', 'summer']);
    expect(suggestTags(all, ' M', ['money']).map((x) => x.name)).toEqual(['meal', 'mood', 'summer']);
    expect(suggestTags(all, 'al', []).map((x) => x.name)).toEqual(['health', 'meal']);
    expect(suggestTags(all, '', [], 2)).toHaveLength(2);
  });
});

describe('TagInput (tasks 3.3)', () => {
  beforeEach(() => {
    latest = [];
  });

  it('creates a new tag inline, normalized (TAG-2, TAG-3)', async () => {
    const app = await renderWithApp(<Harness />);
    await app.user.type(screen.getByRole('combobox', { name: 'Tags' }), '  Deep   Work ');
    expect(options()).toEqual(['Create “deep work”']);
    await app.user.keyboard('{Enter}');
    await waitFor(() => expect(chips()).toEqual(['deep work']));
    expect((await app.repos.tags.list()).map((t) => t.name)).toEqual(['deep work']);
    expect(screen.getByRole('combobox')).toHaveValue('');
  });

  it('autocompletes existing tags and picks with arrows + Enter', async () => {
    const app = await renderWithApp(<Harness />);
    await app.repos.tags.getOrCreate('money');
    await app.repos.tags.getOrCreate('mood');
    await app.repos.tags.getOrCreate('health');
    await app.queryClient.invalidateQueries();

    const input = screen.getByRole('combobox', { name: 'Tags' });
    await app.user.type(input, 'mo');
    await waitFor(() => expect(options()).toEqual(['money', 'mood', 'Create “mo”']));
    expect(input).toHaveAttribute('aria-expanded', 'true');
    await app.user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(chips()).toEqual(['mood']));
    expect(latest).toEqual([(await app.repos.tags.list()).find((t) => t.name === 'mood')!.id]);
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('typing an existing name exactly reuses it instead of creating a duplicate', async () => {
    const app = await renderWithApp(<Harness />);
    const money = await app.repos.tags.getOrCreate('money');
    await app.queryClient.invalidateQueries();
    await app.user.type(screen.getByRole('combobox'), 'Money,');
    await waitFor(() => expect(latest).toEqual([money.id]));
    expect(await app.repos.tags.list()).toHaveLength(1);
  });

  it('comma commits, Backspace removes the last tag, × removes one', async () => {
    const app = await renderWithApp(<Harness />);
    const input = screen.getByRole('combobox');
    await app.user.type(input, 'a,b,c,');
    await waitFor(() => expect(chips()).toEqual(['a', 'b', 'c']));
    await app.user.keyboard('{Backspace}');
    expect(chips()).toEqual(['a', 'b']);
    await app.user.click(screen.getByRole('button', { name: 'Remove tag a' }));
    expect(chips()).toEqual(['b']);
    expect(input).toHaveFocus();
  });

  it('ArrowDown on an empty field lists unchosen tags; Escape closes the list', async () => {
    const app = await renderWithApp(<Harness />);
    const a = await app.repos.tags.getOrCreate('alpha');
    await app.repos.tags.getOrCreate('beta');
    await app.queryClient.invalidateQueries();
    await app.user.click(screen.getByRole('combobox'));
    expect(options()).toEqual([]);
    await app.user.keyboard('{ArrowDown}');
    await waitFor(() => expect(options()).toEqual(['alpha', 'beta']));
    await app.user.keyboard('{Escape}');
    expect(options()).toEqual([]);
    // Enter on an empty field with no list does nothing (lets a surrounding form submit).
    await app.user.keyboard('{Enter}');
    expect(latest).toEqual([]);
    await app.user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(latest).toEqual([a.id]));
  });

  it('clicking a suggestion picks it', async () => {
    const app = await renderWithApp(<Harness />);
    await app.repos.tags.getOrCreate('travel');
    await app.queryClient.invalidateQueries();
    await app.user.type(screen.getByRole('combobox'), 'tr');
    await app.user.click(await screen.findByRole('option', { name: 'travel' }));
    await waitFor(() => expect(chips()).toEqual(['travel']));
  });
});
