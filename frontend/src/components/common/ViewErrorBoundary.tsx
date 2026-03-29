import { Component, type ErrorInfo, type ReactNode } from 'react';

type ViewErrorBoundaryProps = {
  children: ReactNode;
  title: string;
  message: string;
};

type ViewErrorBoundaryState = {
  hasError: boolean;
  errorMessage: string;
};

export class ViewErrorBoundary extends Component<ViewErrorBoundaryProps, ViewErrorBoundaryState> {
  constructor(props: ViewErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(): ViewErrorBoundaryState {
    return { hasError: true, errorMessage: '' };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ViewErrorBoundary caught error:', error, errorInfo);
    this.setState({ errorMessage: String(error?.message || error || 'unknown error') });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-3xl border border-rose-300/60 bg-rose-50/60 p-6 text-left text-rose-700 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-200">
          <div className="text-sm font-black uppercase tracking-widest">{this.props.title}</div>
          <div className="mt-2 text-sm">{this.props.message}</div>
          {this.state.errorMessage ? (
            <div className="mt-3 rounded-xl border border-rose-300/60 bg-white/60 px-3 py-2 font-mono text-xs text-rose-700 dark:border-rose-800/60 dark:bg-rose-900/30 dark:text-rose-200">
              {this.state.errorMessage}
            </div>
          ) : null}
        </div>
      );
    }

    return this.props.children;
  }
}
