import type { ReactNode } from "react";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";

export function PanelState({
  loading,
  error,
  children,
}: {
  loading: boolean;
  error: unknown;
  children: ReactNode;
}) {
  if (loading) return <LoadingState label="Loading federation data" />;
  if (error)
    return (
      <p role="alert" className="text-sm text-state-warning-text">
        Federation data is unavailable.
      </p>
    );
  return children;
}
