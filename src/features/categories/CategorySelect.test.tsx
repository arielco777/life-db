// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import { useState } from 'react';
import { CategorySelect } from './CategorySelect';
import { renderWithApp } from '../../../tests/render';
import { DEFAULT_CATEGORY_IDS } from '@/domain/ids';
import type { UUID } from '@/domain/types';

function Harness({ initial, onChange }: { initial?: UUID; onChange?: (id: UUID | undefined) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <CategorySelect
      aria-label="Category"
      value={value}
      onChange={(id) => {
        setValue(id);
        onChange?.(id);
      }}
    />
  );
}

const optionLabels = () =>
  within(screen.getByRole('combobox', { name: 'Category' }))
    .getAllByRole('option')
    .map((o) => o.textContent);

describe('CategorySelect (tasks 3.2)', () => {
  it('offers "No category" plus active categories, and reports changes', async () => {
    const onChange = vi.fn();
    const { user } = await renderWithApp(<Harness onChange={onChange} />);
    await screen.findByRole('option', { name: 'Health' });
    expect(optionLabels()[0]).toBe('No category');
    expect(optionLabels()).toHaveLength(9);

    await user.selectOptions(screen.getByRole('combobox'), 'Work');
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_CATEGORY_IDS.work);
    await user.selectOptions(screen.getByRole('combobox'), 'No category');
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('hides archived categories for new records (CAT-2)', async () => {
    const app = await renderWithApp(<Harness />);
    await screen.findByRole('option', { name: 'Money' });
    await app.repos.categories.archive(DEFAULT_CATEGORY_IDS.money, true);
    await app.queryClient.invalidateQueries();
    await vi.waitFor(() => expect(screen.queryByRole('option', { name: /Money/ })).not.toBeInTheDocument());
    expect(optionLabels()).toHaveLength(8);
  });

  it("keeps a record's current archived category selectable", async () => {
    const app = await renderWithApp(<Harness initial={DEFAULT_CATEGORY_IDS.money} />);
    await app.repos.categories.archive(DEFAULT_CATEGORY_IDS.money, true);
    await app.queryClient.invalidateQueries();
    const select = screen.getByRole('combobox', { name: 'Category' });
    await within(select).findByRole('option', { name: 'Money (archived)' });
    expect(select).toHaveValue(DEFAULT_CATEGORY_IDS.money);
  });
});
