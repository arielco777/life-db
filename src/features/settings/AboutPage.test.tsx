// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { SettingsPage } from './SettingsPage';
import { fakePlatform } from '../../../tests/fakePlatform';
import { renderWithApp } from '../../../tests/render';

describe('Settings → About (task 10.5)', () => {
  it('shows versions and privacy, reports an issue and opens the log (DIST-4…6)', async () => {
    const platform = fakePlatform();
    const { user } = await renderWithApp(
      <Routes>
        <Route path="/settings/*" element={<SettingsPage />} />
      </Routes>,
      { route: '/settings/about', platform },
    );
    expect(await screen.findByText('1.0.0')).toBeInTheDocument();
    expect(screen.getByText('Data version').nextElementSibling).toHaveTextContent('3');
    expect(screen.getByRole('heading', { name: 'Privacy' })).toBeInTheDocument();
    expect(screen.getByText(/no analytics, no tracking/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Report an issue' }));
    await waitFor(() => expect(platform.openInBrowser).toHaveBeenCalledOnce());
    const url = platform.openInBrowser.mock.calls[0]![0];
    expect(url).toMatch(/^https:\/\/github\.com\/arielco777\/life-db\/issues\/new\?body=/);
    expect(decodeURIComponent(url)).toContain('Life DB 1.0.0 · data version 3');

    await user.click(screen.getByRole('button', { name: 'Open log file' }));
    expect(platform.revealInFolder).toHaveBeenCalledWith('/home/me/.local/share/life-db/logs/life-db.log');
  });
});
