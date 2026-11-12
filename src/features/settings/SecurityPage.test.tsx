// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { SettingsPage } from './SettingsPage';
import { fakePlatform } from '../../../tests/fakePlatform';
import { renderWithApp } from '../../../tests/render';

const open = (platform = fakePlatform()) =>
  renderWithApp(
    <Routes>
      <Route path="/settings/*" element={<SettingsPage />} />
    </Routes>,
    { route: '/settings/security', platform },
  );

describe('Settings → Security (task 8.4)', () => {
  it('explains the encryption, with the key in the system keychain (SEC-4)', async () => {
    await open();
    expect(await screen.findByRole('heading', { name: 'Encryption' })).toBeInTheDocument();
    expect(screen.getByText(/in your system's keychain/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your key is stored in a file' })).not.toBeInTheDocument();
  });

  it('warns when the key had to go in a file (SEC-2 fallback)', async () => {
    await open(fakePlatform({ keyFile: '/home/me/.local/share/life-db/device.key' }));
    expect(await screen.findByRole('heading', { name: 'Your key is stored in a file' })).toBeInTheDocument();
    expect(screen.getByText('/home/me/.local/share/life-db/device.key')).toBeInTheDocument();
    expect(screen.queryByText(/in your system's keychain/)).not.toBeInTheDocument();
  });
});
