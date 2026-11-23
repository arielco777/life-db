// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { ImportSection } from './ImportSection';
import { fakePlatform } from '../../../tests/fakePlatform';
import { setup } from '../../../tests/helpers';
import { renderWithApp } from '../../../tests/render';
import { parseExport } from '@/domain/importFile';

const PATH = '/home/me/life-db-export.json';

/** An export from "the other computer": two habits, an entry, a journal entry. */
async function otherComputerExport() {
  const other = await setup('2026-08-14T12:00:00');
  const run = await other.repos.habits.create({ name: 'Run', type: 'duration', startDate: '2026-01-01' });
  await other.repos.habits.create({ name: 'Read', type: 'boolean', startDate: '2026-01-01' });
  await other.repos.entries.set(run.id, '2026-08-10', 35);
  await other.repos.journal.create({ entryDate: '2026-08-13', title: 'Beach', body: 'Swam' });
  return JSON.stringify(await other.repos.transfer.exportAll({ appVersion: '1.5.0' }));
}

async function open({
  password,
  text,
  alreadyImported = false,
}: { password?: string; text?: string; alreadyImported?: boolean } = {}) {
  const platform = fakePlatform();
  const exportText = text ?? (await otherComputerExport());
  platform.exports.set(PATH, { text: exportText, password });
  platform.nextOpenPath = PATH;
  const app = await renderWithApp(
    async ({ repos }) => {
      if (alreadyImported)
        await repos.transfer.apply(await repos.transfer.plan(parseExport(exportText), 'replace'));
      else await repos.habits.create({ name: 'Gym', type: 'boolean', startDate: '2026-01-01' });
      return (
        <main>
          <ImportSection />
        </main>
      );
    },
    { platform },
  );
  await app.user.click(screen.getByRole('button', { name: 'Import a Life DB export…' }));
  return app;
}

const dialog = () => screen.getByRole('dialog');

describe('Settings → Data → Import (task 17.7)', () => {
  it('merges: choose, preview what changes, import after a backup, then restart (IMP-4..7)', async () => {
    const { user, repos, platform } = await open();
    expect(await screen.findByRole('heading', { name: 'Import this export?' })).toHaveFocus();
    expect(within(dialog()).getByText(/from Life DB 1\.5\.0/)).toBeInTheDocument();
    expect(within(dialog()).getByRole('radio', { name: /Combine with what’s here/ })).toBeChecked();
    await user.click(within(dialog()).getByRole('button', { name: 'Next' }));

    await screen.findByRole('heading', { name: 'What will change' });
    expect(within(dialog()).getByRole('listitem')).toHaveTextContent(
      'Adds 2 habits, 1 habit entry and 1 journal entry.',
    );
    expect(platform.safetyBackup).not.toHaveBeenCalled();
    await user.click(within(dialog()).getByRole('button', { name: 'Import' }));

    await screen.findByRole('heading', { name: 'Imported' });
    expect(platform.safetyBackup).toHaveBeenCalledWith('pre-import');
    expect(within(dialog()).getByRole('status')).toHaveTextContent(
      'Added 2 habits, 1 habit entry and 1 journal entry.',
    );
    expect((await repos.habits.list()).map((h) => h.name).sort()).toEqual(['Gym', 'Read', 'Run']);
    await user.click(within(dialog()).getByRole('button', { name: 'Done' }));
    expect(platform.reloadApp).toHaveBeenCalled();
  });

  it('replaces: says everything here goes, and asks with a destructive button (IMP-3)', async () => {
    const { user, repos } = await open();
    await screen.findByRole('dialog');
    await user.click(within(dialog()).getByRole('radio', { name: /Replace everything here/ }));
    await user.click(within(dialog()).getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'What will change' });
    const items = within(dialog())
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(items).toEqual([
      'Removes everything that was in Life DB: 8 categories and 1 habit.',
      'Adds 8 categories, 2 habits, 1 habit entry and 1 journal entry from the export.',
    ]);
    const go = within(dialog()).getByRole('button', { name: 'Replace everything' });
    expect(go).toHaveClass('danger');
    await user.click(go);
    await screen.findByRole('heading', { name: 'Imported' });
    expect((await repos.habits.list()).map((h) => h.name).sort()).toEqual(['Read', 'Run']);
  });

  it('undo restores the backup made just before the import (IMP-7)', async () => {
    const { user, platform } = await open();
    await user.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Next' }));
    await user.click(await within(dialog()).findByRole('button', { name: 'Import' }));
    await user.click(await within(dialog()).findByRole('button', { name: 'Undo import' }));
    await waitFor(() =>
      expect(platform.restoreFrom).toHaveBeenCalledWith(
        '/home/me/.local/share/life-db/backups/pre-import-1.lifedb',
      ),
    );
    expect(platform.reloadApp).toHaveBeenCalled();
  });

  it('asks for the password of a protected export, and says when it is wrong (EXP-8, IMP-2)', async () => {
    const { user } = await open({ password: 'correct horse' });
    await screen.findByRole('heading', { name: 'This export is protected' });
    const field = within(dialog()).getByLabelText('Password');
    expect(field).toHaveFocus();
    await user.type(field, 'wrong horse{Enter}');
    expect(await within(dialog()).findByText('That password isn’t right.')).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, 'correct horse');
    await user.click(within(dialog()).getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByRole('heading', { name: 'Import this export?' })).toBeInTheDocument();
  });

  it('says when an export holds nothing new', async () => {
    const { user } = await open({ alreadyImported: true });
    await user.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Next' }));
    expect(
      await within(dialog()).findByText('Everything in this export is already here, so nothing will change.'),
    ).toBeInTheDocument();
  });

  it('explains files it can’t import, without opening the dialog (IMP-1, IMP-2)', async () => {
    await open({ text: JSON.stringify({ app: 'life-db', format: 2 }) });
    expect(await screen.findByRole('alert')).toHaveTextContent('made by a newer version of Life DB');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Escape or Cancel closes without changing anything', async () => {
    const { user, repos, platform } = await open();
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(platform.safetyBackup).not.toHaveBeenCalled();
    expect((await repos.habits.list()).map((h) => h.name)).toEqual(['Gym']);
    expect(screen.getByRole('button', { name: 'Import a Life DB export…' })).toHaveFocus();
  });

  it('passes axe on each step', async () => {
    const { user } = await open();
    await screen.findByRole('dialog');
    const check = async () => {
      const r = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
      expect(
        r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
      ).toEqual([]);
    };
    await check();
    await user.click(within(dialog()).getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'What will change' });
    await check();
  });
});
