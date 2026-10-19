import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../ui/Button';

interface Props {
  children: ReactNode;
}
interface State {
  failed: boolean;
}

/**
 * Catches errors thrown while rendering the routed content so one broken page
 * does not blank the whole app. The nav stays outside it, so the user can leave.
 * App keys it by pathname, which resets it on navigation.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Console only: the screen never shows the message or stack, which can leak internals.
    console.error('Render error caught by ErrorBoundary', error, info.componentStack);
  }

  private reset = () => this.setState({ failed: false });

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-card border border-line bg-surface p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="max-w-prose text-muted">
          This page hit an unexpected problem and could not be shown. Your payments are not affected. You can try again, or
          go back to the console.
        </p>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button onClick={this.reset}>Try again</Button>
          {/* Reset too: from "/" the pathname does not change, so the App key alone would not recover. */}
          <Link
            to="/"
            onClick={this.reset}
            className="inline-flex h-10 items-center justify-center rounded-control border border-line bg-surface px-4 text-sm font-medium hover:bg-white/10"
          >
            Go to Console
          </Link>
        </div>
      </div>
    );
  }
}
