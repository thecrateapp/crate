import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@crate/ui/lib/cn";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { ProgressHairline } from "@crate/ui/primitives/ProgressHairline";

export type LoadingStateVariant = "section" | "route" | "page" | "screen";

export interface LoadingStateProps {
  variant?: LoadingStateVariant;
  label?: string;
  /** @deprecated Route indicators no longer use marketing phrases. */
  phrases?: readonly string[];
  className?: string;
  /** Stretch a section beam across its available content area. Route geometry is unchanged. */
  fullWidth?: boolean;
  /** The section's final layout, with reserved readings instead of invented data. */
  children?: ReactNode;
}

function RouteLoadingState({
  variant,
  label,
  className,
}: Required<Pick<LoadingStateProps, "variant" | "label">> &
  Pick<LoadingStateProps, "className">) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 200);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={visible ? label : undefined}
      data-testid="loading-state"
      data-variant={variant}
      className={cn(
        "crate-loading-route",
        variant === "screen" && "min-h-dvh",
        className,
      )}
    >
      {visible ? (
        <div className="crate-loading-route-mark">
          <MonoLabel>{label}</MonoLabel>
          <ProgressHairline label={label} />
        </div>
      ) : null}
    </div>
  );
}

export function LoadingState({
  variant = "section",
  label = "Loading",
  className,
  children,
  fullWidth = false,
}: LoadingStateProps) {
  if (variant !== "section")
    return (
      <RouteLoadingState
        variant={variant}
        label={label}
        className={className}
      />
    );
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      data-testid="loading-state"
      data-variant={variant}
      className={cn("min-w-0", className)}
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">
        {children ?? (
          <div
            className={cn(
              "crate-loading-section",
              fullWidth && "crate-loading-section-full",
            )}
          >
            <MonoLabel>{label}</MonoLabel>
            <ProgressHairline label={label} />
          </div>
        )}
      </div>
    </div>
  );
}
