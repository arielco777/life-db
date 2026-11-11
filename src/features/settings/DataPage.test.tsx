// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { SettingsPage } from './SettingsPage';
import { fakePlatform } from '../../../tests/fakePlatform';
import { renderWithApp } from '../../../tests/render';

const open = (platform = fakePlatform()) =>
  renderWithApp(
    <Routes>
      <Route path="/settings/*" element={<SettingsPage />} />
    </Routes>,
    { route: '/settings/data', platform },
  );

describe('Settings → Data (tasks 8.2, 8.6)', () => {
  it('backs up to the chosen file, suggesting a dated name (EXP-4)', async () => {
    const platform = fakePlatform();
    platform.nextSavePath = '/home/me/Backups/august';
    const { user } = await open(platform);
    await user.click(await screen.findByRole('button', { name: 'Back up now…' }));

    expect(platform.pickSavePath).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultName: expect.stringMatching(/^life-db-\d{4}-\d{2}-\d{2}\.lifedb$/),
        filter: { name: 'Life DB backup', extensions: ['lifedb'] },
      }),
    );
    // A bare name gets the extension.
    await waitFor(() => expect(platform.backups).toEqual(['/home/me/Backups/august.lifedb']));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Backup saved to /home/me/Backups/august.lifedb',
    );
    await user.click(screen.getByRole('button', { name: 'Show in folder' }));
    expect(platform.revealInFolder).toHaveBeenCalledWith('/home/me/Backups/august.lifedb');
  });

  it('cancelling the dialog writes nothing', async () => {
    const platform = fakePlatform();
    const { user } = await open(platform);
    await user.click(await screen.findByRole('button', { name: 'Back up now…' }));
    await waitFor(() => expect(platform.pickSavePath).toHaveBeenCalled());
    expect(platform.backupTo).not.toHaveBeenCalled();
    expect(screen.queryByText(/Backup saved/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back up now…' })).toBeEnabled();
  });

  it('a failed backup says why', async () => {
    const platform = fakePlatform();
    platform.nextSavePath = '/read-only/x.lifedb';
    platform.backupTo.mockRejectedValueOnce(new Error('Permission denied (os error 13)'));
    const { user } = await open(platform);
    await user.click(await screen.findByRole('button', { name: 'Back up now…' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Permission denied (os error 13)');
    expect(screen.queryByText(/Backup saved/)).not.toBeInTheDocument();
  });

  it('shows where the data lives and opens that folder (EXP-7)', async () => {
    const platform = fakePlatform();
    const { user } = await open(platform);
    expect(await screen.findByLabelText('Database file')).toHaveTextContent(
      '/home/me/.local/share/life-db/life.db',
    );
    expect(screen.getByText(/^2\.4 MB\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open folder' }));
    expect(platform.revealInFolder).toHaveBeenCalledWith('/home/me/.local/share/life-db/life.db');
  });

  it('is reachable from the settings tabs', async () => {
    const { user } = await renderWithApp(
      <Routes>
        <Route path="/settings/*" element={<SettingsPage />} />
      </Routes>,
      { route: '/settings/general' },
    );
    await user.click(await screen.findByRole('link', { name: 'Data' }));
    expect(await screen.findByRole('heading', { name: 'Backup' })).toBeInTheDocument();
  });
});
