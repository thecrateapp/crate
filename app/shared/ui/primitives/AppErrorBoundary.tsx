import React, { type ReactNode } from "react";
import { ErrorState } from "@crate/ui/primitives/ErrorState";

interface AppErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error, onReset: () => void) => ReactNode);
  onReset?: () => void;
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

function DefaultFallback({
  error,
  onReset,
}: {
  error: Error;
  onReset: () => void;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-canvas p-6 text-text-primary">
      <ErrorState
        variant="page"
        title="Something went wrong"
        titleAs="h1"
        message={error.message}
        onRetry={onReset}
        retryLabel="Go home"
      />
    </div>
  );
}

export class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Render failed", error, info);
    this.props.onError?.(error, info);
  }

  private handleReset = () => {
    this.setState({ error: null });
    if (this.props.onReset) {
      this.props.onReset();
    } else {
      window.location.href = "/";
    }
  };

  render() {
    if (this.state.error) {
      const { fallback } = this.props;
      if (fallback) {
        if (typeof fallback === "function") {
          return fallback(this.state.error, this.handleReset);
        }
        return fallback;
      }
      return (
        <DefaultFallback error={this.state.error} onReset={this.handleReset} />
      );
    }
    return this.props.children;
  }
}
