// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { ExportSection } from './ExportSection';
import { fakePlatform } from '../../../tests/fakePlatform';
import { renderWithApp } from '../../../tests/render';
import type { setup } from '../../../tests/helpers';
import { exportFileSchema } from '@/domain/transfer';

type Repos = Awaited<ReturnType<typeof setup>>['repos'];

async function seed(repos: Repos) {
  const travel = await repos.tags.getOrCreate('travel');
  const run = await repos.habits.create({ name: 'Run', type: 'duration', startDate: '2026-01-01' });
  const old = await repos.habits.create({ name: 'Old habit', type: 'boolean', startDate: '2026-01-01' });
  await repos.entries.set(run.id, '2026-07-31', 25);
  await repos.entries.set(run.id, '2026-08-01', 35, 'felt strong');
  await repos.entries.set(old.id, '2026-08-01', 1);
  await repos.habits.archive(old.id, true);
  await repos.journal.create({ entryDate: '2026-08-01', title: 'Beach', body: 'Swam', tagIds: [travel.id] });
  await repos.journal.create({ entryDate: '2026-06-01', body: 'Earlier' });
}

async function open(platform = fakePlatform()) {
  const app = await renderWithApp(
    async ({ repos }) => {
      await seed(repos);
      return (
        <main>
          <ExportSection />
        </main>
      );
    },
    { platform },
  );
  return app;
}

const part = (name: string) => screen.getByRole('region', { name });

describe('Settings → Data → Export (task 16.7)', () => {
  it('exports everything as a JSON file Life DB can import (EXP-1)', async () => {
    const platform = fakePlatform();
    platform.nextSavePath = '/home/me/life';
    const { user } = await open(platform);
    const json = part('Everything (JSON)');
    expect(within(json).getByText(/anyone who has it can read everything/)).toBeInTheDocument();
    await user.click(within(json).getByRole('button', { name: 'Export everything…' }));

    expect(platform.pickSavePath).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultName: expect.stringMatching(/^life-db-export-\d{4}-\d{2}-\d{2}\.json$/),
      }),
    );
    await within(json).findByRole('status');
    // A bare name gets the extension; no password means a plain file.
    const written = platform.exports.get('/home/me/life.json')!;
    expect(written.password).toBeUndefined();
    const file = exportFileSchema.parse(JSON.parse(written.text));
    expect(file.appVersion).toBe('1.0.0');
    expect(file.habits.map((h) => ('name' in h ? h.name : null)).sort()).toEqual(['Old habit', 'Run']);
    expect(within(json).getByRole('status')).toHaveTextContent('Export saved to /home/me/life.json');
  });

  it('protects the export with a password once it is long enough and repeated (EXP-8)', async () => {
    const platform = fakePlatform();
    platform.nextSavePath = '/home/me/life.lifedb-export';
    const { user } = await open(platform);
    const json = part('Everything (JSON)');
    await user.click(within(json).getByRole('checkbox', { name: 'Protect with a password' }));
    expect(within(json).getByText(/can’t recover a forgotten one/)).toBeInTheDocument();
    const go = within(json).getByRole('button', { name: 'Export everything…' });

    await user.type(within(json).getByLabelText(/^Password/), 'short');
    await user.click(go);
    expect(within(json).getByText('Use at least 8 characters.')).toBeInTheDocument();
    await user.type(within(json).getByLabelText(/^Password/), ' but now long');
    await user.type(within(json).getByLabelText('Repeat password'), 'short but now lonG');
    await user.click(go);
    expect(within(json).getByText('The passwords don’t match.')).toBeInTheDocument();
    expect(platform.pickSavePath).not.toHaveBeenCalled();

    await user.clear(within(json).getByLabelText('Repeat password'));
    await user.type(within(json).getByLabelText('Repeat password'), 'short but now long');
    await user.click(go);
    expect(platform.pickSavePath).toHaveBeenCalledWith(
      expect.objectContaining({ defaultName: expect.stringMatching(/\.lifedb-export$/) }),
    );
    await within(json).findByRole('status');
    expect(platform.exports.get('/home/me/life.lifedb-export')?.password).toBe('short but now long');
    // The password isn't kept once used.
    expect(within(json).getByLabelText(/^Password/)).toHaveValue('');
  });

  it('exports habit history as CSV, in the chosen layout and dates (EXP-2)', async () => {
    const platform = fakePlatform();
    platform.nextSavePath = '/home/me/habits.csv';
    const { user } = await open(platform);
    const csv = part('Habit history (CSV)');
    await user.click(within(csv).getByRole('button', { name: 'Export habits…' }));
    await within(csv).findByRole('status');
    expect(platform.exports.get('/home/me/habits.csv')!.text.split('\r\n')).toEqual([
      '﻿date,habit,type,value,unit,note',
      '2026-07-31,Run,duration,25,minutes,',
      '2026-08-01,Run,duration,35,minutes,felt strong',
      '',
    ]);

    await user.click(within(csv).getByRole('radio', { name: 'One row per day' }));
    await user.click(within(csv).getByRole('checkbox', { name: 'Include archived habits' }));
    await user.type(within(csv).getByLabelText(/^From/), '2026-08-01');
    await user.click(within(csv).getByRole('button', { name: 'Export habits…' }));
    await waitFor(() =>
      expect(platform.exports.get('/home/me/habits.csv')!.text.split('\r\n')).toEqual([
        '﻿date,Run,Old habit',
        '2026-08-01,35,1',
        '',
      ]),
    );
  });

  it('refuses a date range that ends before it starts', async () => {
    const { user } = await open();
    const csv = part('Habit history (CSV)');
    await user.type(within(csv).getByLabelText(/^From/), '2026-08-02');
    await user.type(within(csv).getByLabelText(/^To/), '2026-08-01');
    expect(within(csv).getByText('Choose a date on or after From.')).toBeInTheDocument();
    expect(within(csv).getByRole('button', { name: 'Export habits…' })).toBeDisabled();
  });

  it('exports the journal as Markdown files in a new folder (EXP-3)', async () => {
    const platform = fakePlatform();
    platform.nextFolder = '/home/me/Documents';
    const { user } = await open(platform);
    const md = part('Journal (Markdown)');
    await user.click(within(md).getByRole('button', { name: 'Export journal…' }));
    expect(await within(md).findByRole('status')).toHaveTextContent(
      /^2 entries saved to \/home\/me\/Documents\/Life DB journal \d{4}-\d{2}-\d{2}/,
    );
    const [folder] = platform.folders;
    expect(folder!.files.map((f) => f.name)).toEqual(['2026-06-01 Earlier.md', '2026-08-01 Beach.md']);
    expect(folder!.files[1]!.text).toContain('tags: ["travel"]');

    await user.click(within(md).getByRole('button', { name: 'Show in folder' }));
    expect(platform.revealInFolder).toHaveBeenCalledWith(folder!.path);
  });

  it('says when there is no journal to export, without asking for a folder', async () => {
    const platform = fakePlatform();
    const { user } = await open(platform);
    const md = part('Journal (Markdown)');
    await user.type(within(md).getByLabelText(/^From/), '2030-01-01');
    await user.click(within(md).getByRole('button', { name: 'Export journal…' }));
    expect(await within(md).findByRole('status')).toHaveTextContent(
      'No journal entries in those dates, so there’s nothing to export.',
    );
    expect(platform.pickFolder).not.toHaveBeenCalled();
  });

  it('cancelling a dialog writes nothing', async () => {
    const platform = fakePlatform();
    const { user } = await open(platform);
    await user.click(screen.getByRole('button', { name: 'Export everything…' }));
    await user.click(screen.getByRole('button', { name: 'Export journal…' }));
    await waitFor(() => expect(platform.pickFolder).toHaveBeenCalled());
    expect(platform.writeExport).not.toHaveBeenCalled();
    expect(platform.writeFolder).not.toHaveBeenCalled();
  });

  it('passes axe', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('checkbox', { name: 'Protect with a password' }));
    const r = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual(
      [],
    );
  });
});
