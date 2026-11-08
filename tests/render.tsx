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
 * with the same providers as the app. Pass a function to seed data before the first render.
 * Component test files need `@vitest-environment jsdom`.
 */
type Ctx = Awaited<ReturnType<typeof setup>>;

export async function renderWithApp(
  ui: ReactElement | ((ctx: Ctx) => ReactElement | Promise<ReactElement>),
  { route = '/' }: { route?: string } = {},
) {
  const ctx = await setup();
  const element = typeof ui === 'function' ? await ui(ctx) : ui;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  const user = userEvent.setup();
  const result = render(
    <RepositoryProvider repos={ctx.repos}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={[route]}>{element}</MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    </RepositoryProvider>,
  );
  return { ...ctx, ...result, user, queryClient };
}
