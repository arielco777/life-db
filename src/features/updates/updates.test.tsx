// @vitest-environment jsdom
import { act, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { isCheckDue, updateKeys } from './updates';
import { UpdateNotice } from './UpdateNotice';
import { fakePlatform } from '../../../tests/fakePlatform';
import { renderWithApp } from '../../../tests/render';
import { SettingsPage } from '@/features/settings/SettingsPage';
import type { AvailableUpdate } from '@/platform/PlatformService';

// Background work normally waits for the first screen; here it runs at once.
vi.mock('@/app/startup', () => ({ afterInteractive: (fn: () => void) => fn(), markInteractive: () => {} }));

const fakeUpdate = (install = vi.fn(async (p?: (f: number | null) => void) => p?.(1))): AvailableUpdate => ({
  version: '1.1.0',
  notes: '## New\n- **Faster** month view',
  install,
});

describe('isCheckDue (DIST-2)', () => {
  const now = new Date('2026-08-14T12:00:00Z');
  it.each([
    ['', true],
    ['2026-08-13T11:00:00Z', true], // 25 h ago
    ['2026-08-13T13:00:00Z', false], // 23 h ago
    ['2026-08-20T00:00:00Z', true], // in the future: the clock went back
    ['nonsense', true],
  ])('last checked %s → due %s', (last, due) => {
    expect(isCheckDue(last, now)).toBe(due);
  });
});

describe('Update notice (task 10.3, DIST-2)', () => {
  it('checks once a day when on, and records the time', async () => {
    const platform = fakePlatform();
    const { repos } = await renderWithApp(<UpdateNotice />, { platform });
    await waitFor(() => expect(platform.checkForUpdate).toHaveBeenCalledOnce());
    await waitFor(async () => expect((await repos.settings.getAll())['updates.last_checked']).not.toBe(''));
  });

  it('never checks when turned off', async () => {
    const platform = fakePlatform();
    await renderWithApp(
      async ({ repos }) => {
        await repos.settings.set('updates.enabled', false);
        return <UpdateNotice />;
      },
      { platform },
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(platform.checkForUpdate).not.toHaveBeenCalled();
  });

  it('does not check again within a day', async () => {
    const platform = fakePlatform();
    await renderWithApp(
      async ({ repos }) => {
        await repos.settings.set('updates.last_checked', new Date(Date.now() - 60_000).toISOString());
        return <UpdateNotice />;
      },
      { platform },
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(platform.checkForUpdate).not.toHaveBeenCalled();
  });

  it('shows notes and installs only after the user agrees, then restarts', async () => {
    const platform = fakePlatform();
    const install = vi.fn(async (p?: (f: number | null) => void) => p?.(1));
    platform.nextUpdate = fakeUpdate(install);
    const { user } = await renderWithApp(<UpdateNotice />, { platform });

    expect(await screen.findByText('Life DB 1.1.0 is available.')).toBeInTheDocument();
    expect(install).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'See what’s new' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Update to Life DB 1.1.0?' });
    expect(await within(dialog).findByText('Faster')).toBeInTheDocument();
    expect(install).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Install and restart' }));
    await waitFor(() => expect(platform.restartApp).toHaveBeenCalledOnce());
    expect(install).toHaveBeenCalledOnce();
  });

  it('"Later" hides it; a failed install says so and changes nothing', async () => {
    const platform = fakePlatform();
    platform.nextUpdate = fakeUpdate(vi.fn(async () => Promise.reject(new Error('signature mismatch'))));
    const { user, queryClient } = await renderWithApp(<UpdateNotice />, { platform });

    await user.click(await screen.findByRole('button', { name: 'See what’s new' }));
    await user.click(screen.getByRole('button', { name: 'Install and restart' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'couldn’t be installed. Your data is unchanged.',
    );
    expect(platform.restartApp).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByText(/is available/)).not.toBeInTheDocument();
    act(() => queryClient.setQueryData(updateKeys.available, fakeUpdate()));
    expect(await screen.findByText('Life DB 1.1.0 is available.')).toBeInTheDocument();
  });
});

describe('Settings → About → Updates', () => {
  const open = (platform = fakePlatform()) =>
    renderWithApp(
      async ({ repos }) => {
        await repos.settings.set('updates.enabled', false);
        return (
          <Routes>
            <Route path="/settings/*" element={<SettingsPage />} />
          </Routes>
        );
      },
      { route: '/settings/about', platform },
    );

  it('checks on request and can turn automatic checks back on', async () => {
    const platform = fakePlatform();
    const { user, repos } = await open(platform);
    expect(await screen.findByText('Not checked yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check now' }));
    expect(await screen.findByText('You have the latest version.')).toBeInTheDocument();

    platform.nextUpdate = fakeUpdate();
    await user.click(screen.getByRole('button', { name: 'Check now' }));
    expect(await screen.findByText(/Version 1\.1\.0 is available/)).toBeInTheDocument();

    const toggle = screen.getByRole('checkbox', { name: 'Check for new versions once a day' });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    await waitFor(async () => expect((await repos.settings.getAll())['updates.enabled']).toBe(true));
  });

  it('says when GitHub can’t be reached', async () => {
    const platform = fakePlatform();
    platform.checkForUpdate.mockRejectedValueOnce(new Error('offline'));
    const { user } = await open(platform);
    await user.click(await screen.findByRole('button', { name: 'Check now' }));
    expect(await screen.findByText(/Couldn’t reach GitHub/)).toBeInTheDocument();
    expect(platform.log).toHaveBeenCalledWith('warn', expect.stringMatching(/^Update check failed/));
  });
});
