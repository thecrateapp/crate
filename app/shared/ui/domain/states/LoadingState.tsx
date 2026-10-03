import { Loader2 } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";

import { CrateLoader } from "../brand/CrateLoader";

export type LoadingStateVariant = "section" | "page" | "screen";

export interface LoadingStateProps {
  variant?: LoadingStateVariant;
  label?: string;
  phrases?: readonly string[];
  className?: string;
}

export function LoadingState({
  variant = "section",
  label = "Loading",
  phrases,
  className,
}: LoadingStateProps) {
  if (variant === "section") {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="loading-state"
        data-variant={variant}
        className={cn("flex items-center justify-center py-16", className)}
      >
        <Loader2
          size={24}
          aria-hidden="true"
          className="animate-spin text-accent-action"
        />
        <span className="sr-only">{label}</span>
      </div>
    );
  }

  return (
    <CrateLoader
      variant={variant}
      label={label}
      phrases={phrases}
      className={className}
    />
  );
}
