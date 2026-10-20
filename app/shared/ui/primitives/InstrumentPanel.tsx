import { useId, type ComponentProps, type ReactNode } from "react";

import { cn } from "@crate/ui/lib/cn";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

export interface InstrumentPanelProps {
  label: Pick<
    ComponentProps<typeof MonoLabel>,
    "accent" | "meta" | "children" | "tone"
  >;
  meta?: ReactNode;
  status?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  summary?: string;
  ruled?: boolean;
  as?: "figure" | "section";
  headingLevel?: 2 | 3;
  children: ReactNode;
  className?: string;
}

export function InstrumentPanel({
  label,
  meta,
  status,
  description,
  actions,
  summary,
  ruled = true,
  as: Element = "figure",
  headingLevel,
  children,
  className,
}: InstrumentPanelProps) {
  const headingId = useId();
  const descriptionId = useId();
  const hasDescription =
    description != null && description !== false && description !== "";

  return (
    <Element
      aria-label={summary}
      aria-labelledby={!summary ? headingId : undefined}
      aria-describedby={hasDescription ? descriptionId : undefined}
      data-slot="instrument-panel"
      className={cn(
        "mx-0 min-w-0 pt-5.5 @container",
        ruled && "border-t border-border-quiet",
        className,
      )}
    >
      <header
        data-slot="instrument-panel-header"
        className={cn(
          "mb-5 flex min-w-0 flex-wrap justify-between gap-x-6 gap-y-2",
          actions != null ? "items-start" : "items-baseline",
        )}
      >
        <MonoLabel
          {...label}
          as={headingLevel ? (headingLevel === 2 ? "h2" : "h3") : "p"}
          id={headingId}
          className="min-w-0 wrap-anywhere"
        />
        {meta != null || status != null || actions != null ? (
          <div className="flex min-w-0 max-w-full flex-wrap items-baseline gap-x-6 gap-y-2">
            {meta != null ? (
              <MonoLabel as="div" className="min-w-0 wrap-anywhere">
                {meta}
              </MonoLabel>
            ) : null}
            {status != null ? (
              <MonoLabel
                as="div"
                className="flex min-w-0 wrap-anywhere"
                aria-live="polite"
              >
                {status}
              </MonoLabel>
            ) : null}
            {actions != null ? (
              <div
                data-slot="instrument-panel-actions"
                className="flex min-w-0 max-w-full flex-wrap items-center gap-2"
              >
                {actions}
              </div>
            ) : null}
          </div>
        ) : null}
      </header>
      {hasDescription ? (
        <div
          id={descriptionId}
          data-slot="instrument-panel-description"
          className="mb-5 text-sm text-text-muted"
        >
          {description}
        </div>
      ) : null}
      {children}
    </Element>
  );
}
