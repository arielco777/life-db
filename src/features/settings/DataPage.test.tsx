// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
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

describe('Settings → Data (tasks 8.2, 8.3, 8.5, 8.6)', () => {
  it('backs up to the chosen file, suggesting a dated name (EXP-4)', async () => {
    const platform = fakePlatform();
    platform.nextSavePath = '/home/me/Backups/august';
    const { user } = await open(platform);
    await user.click(await screen.findByRole('button', { name: 'Back up now…' }));

    expect(platform.pickSavePath).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultName: expect.stringMatching(/^life-db-\d{4}-\d{2}-\d{2}\.lifedb$/),
        filters: [{ name: 'Life DB backup', extensions: ['lifedb'] }],
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

  it('restores a chosen backup after confirming, then restarts the app (EXP-5)', async () => {
    const platform = fakePlatform();
    platform.nextOpenPath = '/media/usb/life-db-2026-08-01.lifedb';
    const { user } = await open(platform);
    await user.click(await screen.findByRole('button', { name: 'Restore from backup…' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('life-db-2026-08-01.lifedb');
    expect(dialog).toHaveTextContent(/current data is saved to the backups folder first/);
    expect(platform.restoreFrom).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(platform.reloadApp).toHaveBeenCalled());
    expect(platform.restoreFrom).toHaveBeenCalledWith('/media/usb/life-db-2026-08-01.lifedb');
  });

  it('cancelling the confirmation, or the dialog, restores nothing', async () => {
    const platform = fakePlatform();
    const { user } = await open(platform);
    await user.click(await screen.findByRole('button', { name: 'Restore from backup…' }));
    await waitFor(() => expect(platform.pickOpenPath).toHaveBeenCalled());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    platform.nextOpenPath = '/x.lifedb';
    await user.click(screen.getByRole('button', { name: 'Restore from backup…' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(platform.restoreFrom).not.toHaveBeenCalled();
    expect(platform.reloadApp).not.toHaveBeenCalled();
  });

  it('a rejected backup shows why and keeps the app running', async () => {
    const platform = fakePlatform();
    platform.nextOpenPath = '/other-laptop.lifedb';
    platform.restoreFrom.mockRejectedValueOnce(
      new Error("This file isn't a Life DB backup from this device."),
    );
    const { user } = await open(platform);
    await user.click(await screen.findByRole('button', { name: 'Restore from backup…' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Restore' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This file isn't a Life DB backup from this device.",
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(platform.reloadApp).not.toHaveBeenCalled();
  });

  it('automatic backups can be turned off and kept for longer (EXP-6)', async () => {
    const { user, repos } = await open();
    expect(await screen.findByText(/Latest: Aug 14, 2026\./)).toBeInTheDocument();
    const keep = screen.getByLabelText('Keep the last');
    expect(keep).toHaveValue('7');
    await user.selectOptions(keep, '30 days');
    await waitFor(async () => expect((await repos.settings.getAll())['backup.keep_count']).toBe(30));

    const toggle = screen.getByRole('checkbox', { name: /Back up once a day/ });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    await waitFor(async () => expect((await repos.settings.getAll())['backup.auto_enabled']).toBe(false));
    expect(screen.getByLabelText('Keep the last')).toBeDisabled();
  });

  it('says when there is no automatic backup yet', async () => {
    await open(fakePlatform({ lastAutoBackup: null }));
    expect(await screen.findByText(/None yet\./)).toBeInTheDocument();
  });
});
