"use client";

import { Component, type ReactNode, type ErrorInfo } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex items-center justify-center min-h-[320px] p-6">
          <div className="flex flex-col items-center gap-4 text-center max-w-md">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-900/40 border border-red-800">
              <AlertTriangle size={24} className="text-red-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-100 mb-1">
                Something went wrong
              </h2>
              <p className="text-sm text-zinc-400">
                {this.state.error?.message || "An unexpected error occurred."}
              </p>
            </div>
            <button
              onClick={this.handleRetry}
              className="inline-flex items-center gap-2 rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700 transition-colors"
            >
              <RotateCcw size={14} />
              Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
