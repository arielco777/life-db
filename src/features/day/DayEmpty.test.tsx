// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { DayRoute } from './DayPage';
import { renderWithApp } from '../../../tests/render';
import type { setup } from '../../../tests/helpers';

type Ctx = Awaited<ReturnType<typeof setup>>;

const open = (seed?: (ctx: Ctx) => Promise<unknown>) =>
  renderWithApp(
    async (ctx) => {
      await seed?.(ctx);
      return (
        <Routes>
          <Route path="/day/:date?" element={<DayRoute />} />
        </Routes>
      );
    },
    { route: '/day/2026-08-13' },
  );

describe('Daily view empty states (task 9.3)', () => {
  it('with no habits at all, invites the first one', async () => {
    await open();
    expect(await screen.findByText(/No habits yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a habit' })).toHaveAttribute('href', '/habits/new');
  });

  it('with habits that do not run that day, says why', async () => {
    await open(({ repos }) =>
      repos.habits.create({ name: 'Later', type: 'boolean', startDate: '2026-09-01' }),
    );
    expect(await screen.findByText(/No habits run on this day/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See your habits' })).toHaveAttribute('href', '/habits');
  });
});
