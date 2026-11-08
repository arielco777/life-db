import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { setup } from './helpers';
import { RepositoryProvider } from '@/app/RepositoryProvider';
import { ToastProvider } from '@/ui/Toast';

/**
 * Renders UI against real repositories over an in-memory SQLite database (design §9),
 * with the same providers as the app. Component test files need `@vitest-environment jsdom`.
 */
export async function renderWithApp(ui: ReactElement, { route = '/' }: { route?: string } = {}) {
  const ctx = await setup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  const user = userEvent.setup();
  const result = render(
    <RepositoryProvider repos={ctx.repos}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    </RepositoryProvider>,
  );
  return { ...ctx, ...result, user, queryClient };
}
