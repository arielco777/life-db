// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { useApplyTheme } from './hooks';
import { SettingsPage } from './SettingsPage';
import { renderWithApp } from '../../../tests/render';

function WithTheme() {
  useApplyTheme();
  return <SettingsPage />;
}

const open = () =>
  renderWithApp(
    <Routes>
      <Route path="/settings/*" element={<WithTheme />} />
    </Routes>,
    { route: '/settings/general' },
  );

describe('Settings → General (task 9.2)', () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });

  it('saves week start, day start and date format (SET-2, SET-4)', async () => {
    const { user, repos } = await open();
    const all = () => repos.settings.getAll();

    await user.selectOptions(await screen.findByLabelText('Week starts on'), 'Sunday');
    await waitFor(async () => expect((await all()).week_start).toBe('sun'));

    const dayStart = screen.getByLabelText('A new day starts at');
    expect(dayStart).toHaveValue('4');
    expect(screen.getByText(/Until 4 a\.m\., the app still shows the day before/)).toBeInTheDocument();
    await user.selectOptions(dayStart, 'Midnight');
    await waitFor(async () => expect((await all()).day_start_hour).toBe(0));
    expect(screen.getByText('Each day starts at midnight.')).toBeInTheDocument();

    const fmt = screen.getByLabelText('Date format');
    // Each option shows today in that format.
    expect(screen.getAllByRole('option').some((o) => /^\d{4}-\d{2}-\d{2}$/.test(o.textContent ?? ''))).toBe(
      true,
    );
    await user.selectOptions(
      fmt,
      screen.getAllByRole('option').find((o) => /^\d{2}\.\d{2}\.\d{4}$/.test(o.textContent ?? ''))!,
    );
    await waitFor(async () => expect((await all()).date_format).toBe('dd.MM.yyyy'));
  });

  it('applies the theme at once; "Same as system" follows the OS (SET-2)', async () => {
    const { user, repos } = await open();
    const theme = await screen.findByLabelText('Theme');
    expect(document.documentElement.dataset.theme).toBeUndefined();
    await user.selectOptions(theme, 'Dark');
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    await waitFor(async () => expect((await repos.settings.getAll()).theme).toBe('dark'));
    await user.selectOptions(theme, 'Same as system');
    await waitFor(() => expect(document.documentElement.dataset.theme).toBeUndefined());
  });

  it('saves the name when leaving the field, trimmed (SET-3)', async () => {
    const { user, repos } = await open();
    const name = await screen.findByLabelText('Your name');
    await user.type(name, '  Ariel ');
    expect((await repos.settings.getAll())['profile.display_name']).toBe('');
    await user.keyboard('{Enter}');
    await waitFor(async () => expect((await repos.settings.getAll())['profile.display_name']).toBe('Ariel'));
    expect(screen.getByLabelText('Your name')).toHaveValue('Ariel');
  });
});
