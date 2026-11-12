import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { errorMessage } from './errors';

type ToastKind = 'info' | 'error';
interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastApi {
  show(text: string, kind?: ToastKind): void;
  /** Shows an error toast for a failed operation (design §7: toasts for errors). */
  error(e: unknown): void;
}

const ToastContext = createContext<ToastApi | null>(null);
const TIMEOUT_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = useCallback(
    (text: string, kind: ToastKind = 'info') => {
      const id = nextId.current++;
      setItems((xs) => [...xs.slice(-2), { id, kind, text }]);
      setTimeout(() => dismiss(id), TIMEOUT_MS);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(() => ({ show, error: (e) => show(errorMessage(e), 'error') }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <span>{t.text}</span>
            <button type="button" className="ghost" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast() used outside <ToastProvider>');
  return api;
}
