import type { ReactNode } from "react";

import { AlertTriangle, CRATE_ICON_SIZE, RefreshCw } from "@crate/ui/icons";
import { Button } from "@crate/ui/shadcn/button";

export interface ErrorStateProps {
  message?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorState({
  message = "Something went wrong",
  onRetry,
  retryLabel = "Retry",
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <AlertTriangle size={32} className="text-state-danger-text mb-3" />
      <p className="text-text-muted mb-4">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw size={CRATE_ICON_SIZE.sm} className="mr-1" /> {retryLabel}
        </Button>
      )}
    </div>
  );
}
