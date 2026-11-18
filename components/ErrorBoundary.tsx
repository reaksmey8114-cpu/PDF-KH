import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
  errorDetails?: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    let message = error.message || 'An unexpected error occurred.';
    let details: string | undefined;
    try {
      const parsed = JSON.parse(message);
      if (parsed && parsed.error && parsed.operationType) {
        message = `Database ${parsed.operationType} failed at ${parsed.path || 'unknown path'}`;
        details = parsed.error;
      }
    } catch {
      // Standard error string
    }
    return { hasError: true, errorMessage: message, errorDetails: details };
  }

  componentDidCatch(error: Error) {
    console.error('ErrorBoundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
          <div className="max-w-lg w-full bg-white border border-slate-200 rounded-xl p-8">
            <div className="flex items-center gap-3 text-red-700 mb-3">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h2 className="text-lg font-semibold">Application Error</h2>
            </div>
            <p className="text-sm text-slate-700 mb-2">{this.state.errorMessage}</p>
            {this.state.errorDetails && (
              <p className="text-xs font-mono bg-slate-50 border border-slate-200 rounded-md p-3 text-slate-600 mb-5 break-words">
                {this.state.errorDetails}
              </p>
            )}
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, errorMessage: '', errorDetails: undefined })}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Reload Workspace
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
