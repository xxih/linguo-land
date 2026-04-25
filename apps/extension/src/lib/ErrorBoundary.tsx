import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Logger } from '../utils/logger';

interface Props {
  children: ReactNode;
  /** Logger scope shown in error logs to identify the failing subtree. */
  scope?: string;
  /** Override the default minimal fallback. */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  private logger: Logger;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
    this.logger = new Logger(props.scope ?? 'ErrorBoundary');
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.logger.error('React subtree crashed', error, {
      componentStack: info.componentStack ?? undefined,
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="p-3 text-xs text-red-900">
            Something went wrong. See the console for details.
          </div>
        )
      );
    }
    return this.props.children;
  }
}
