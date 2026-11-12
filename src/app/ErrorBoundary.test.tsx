// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { useState } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { fakePlatform } from '../../tests/fakePlatform';
import { renderWithApp } from '../../tests/render';

let failing = true;
function Fragile() {
  const [n] = useState(0);
  if (failing) throw new Error('render failed for "Dear diary"');
  return <p>Recovered {n}</p>;
}

describe('ErrorBoundary (task 10.6, DIST-6)', () => {
  beforeEach(() => {
    failing = true;
    vi.spyOn(console, 'error').mockImplementation(() => {}); // React reports caught errors too
  });
  afterEach(() => vi.restoreAllMocks());

  it('logs the error without user content, explains, and can try again', async () => {
    const platform = fakePlatform();
    const { user } = await renderWithApp(
      <ErrorBoundary>
        <Fragile />
      </ErrorBoundary>,
      { platform },
    );
    expect(screen.getByRole('heading', { name: 'This screen ran into a problem' })).toBeInTheDocument();
    expect(screen.getByText(/Your data is safe/)).toBeInTheDocument();
    const [level, message] = platform.log.mock.calls[0]!;
    expect(level).toBe('error');
    expect(message).toMatch(/^Screen crashed: Error: render failed for "…"/);
    expect(message).not.toContain('Dear diary');

    await user.click(screen.getByRole('button', { name: 'report an issue' }));
    expect(decodeURIComponent(platform.openInBrowser.mock.calls[0]![0])).not.toContain('Dear diary');

    failing = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Recovered 0')).toBeInTheDocument();
  });
});
