import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { describeError, issueUrl } from './diagnostics';
import { usePlatform } from '@/platform/PlatformProvider';
import type { PlatformService } from '@/platform/PlatformService';

interface Props {
  children: ReactNode;
  platform: PlatformService;
}

/**
 * Catches a screen that fails to render (DIST-6): logs the error, shows a way out, and
 * leaves the rest of the app (navigation) working. App gives it a key per route, so going
 * to another screen starts fresh.
 */
class Boundary extends Component<Props, { error: unknown }> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const components = (info.componentStack ?? '').split('\n').filter(Boolean).slice(0, 6).join('\n');
    this.props.platform.log('error', `Screen crashed: ${describeError(error)}\n${components}`);
  }

  report = async () => {
    const { platform } = this.props;
    try {
      await platform.openInBrowser(issueUrl(await platform.appInfo(), describeError(this.state.error)));
    } catch {
      // Opening the browser failed; nothing more to do from here.
    }
  };

  openLog = async () => {
    const { platform } = this.props;
    try {
      await platform.revealInFolder((await platform.appInfo()).logFile);
    } catch {
      // As above.
    }
  };

  render() {
    if (this.state.error === null) return this.props.children;
    return (
      <section className="stack" role="alert">
        <h1 className="page-title">This screen ran into a problem</h1>
        <p>Your data is safe. Nothing you saved was lost.</p>
        <div className="row">
          <button type="button" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <Link to="/day" className="button secondary">
            Go to today
          </Link>
        </div>
        <p className="small muted">
          If it keeps happening, please{' '}
          <button type="button" className="link-button" onClick={() => void this.report()}>
            report an issue
          </button>
          . The{' '}
          <button type="button" className="link-button" onClick={() => void this.openLog()}>
            log file
          </button>{' '}
          has the details, and none of your entries.
        </p>
      </section>
    );
  }
}

export function ErrorBoundary({ children }: { children: ReactNode }) {
  return <Boundary platform={usePlatform()}>{children}</Boundary>;
}
