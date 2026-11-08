// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { SettingsPage } from './SettingsPage';
import { renderWithApp } from '../../../tests/render';

function Where() {
  return <output aria-label="path">{useLocation().pathname}</output>;
}

const render = (route: string) =>
  renderWithApp(
    <>
      <Routes>
        <Route path="/settings/*" element={<SettingsPage />} />
      </Routes>
      <Where />
    </>,
    { route },
  );

describe('SettingsPage routing', () => {
  it.each(['/settings', '/settings/nope', '/settings/nope/deeper'])(
    '%s redirects to General',
    async (route) => {
      await render(route);
      expect(await screen.findByText(/Preferences arrive/)).toBeInTheDocument();
      expect(screen.getByLabelText('path')).toHaveTextContent(/^\/settings\/general$/);
    },
  );

  it('switches tabs', async () => {
    const { user } = await render('/settings');
    await user.click(await screen.findByRole('link', { name: 'Categories' }));
    expect(await screen.findByRole('heading', { name: 'Categories' })).toBeInTheDocument();
  });
});
