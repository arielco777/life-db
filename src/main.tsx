import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './app/App';
import { boot, type BootResult } from './app/boot';
import { BootScreen } from './app/BootScreen';
import { installCloseGuard } from './app/closeGuard';
import { RepositoryProvider } from './app/RepositoryProvider';
import { PlatformProvider } from './platform/PlatformProvider';
import { tauriPlatform } from './platform/tauriPlatform';
import { ToastProvider } from './ui/Toast';
import './ui/tokens.css';
import './ui/app.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false } },
});

function Root() {
  const [result, setResult] = useState<BootResult | null>(null);
  useEffect(() => {
    void boot().then(setResult);
    void installCloseGuard();
  }, []);

  if (!result || result.kind !== 'ready') return <BootScreen result={result} />;
  return (
    <RepositoryProvider repos={result.repos}>
      <PlatformProvider platform={tauriPlatform}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <HashRouter>
              <App />
            </HashRouter>
          </ToastProvider>
        </QueryClientProvider>
      </PlatformProvider>
    </RepositoryProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
