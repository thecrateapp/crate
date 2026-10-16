import { useId, type ReactNode } from "react";

import { cn } from "@crate/ui/lib/cn";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

interface InstrumentPanelProps {
  label: {
    accent?: ReactNode;
    meta?: readonly (string | null | false | undefined)[];
    children?: ReactNode;
  };
  meta?: ReactNode;
  status?: ReactNode;
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
  summary,
  ruled = true,
  as: Element = "figure",
  headingLevel,
  children,
  className,
}: InstrumentPanelProps) {
  const headingId = useId();

  return (
    <Element
      aria-label={summary}
      aria-labelledby={!summary && headingLevel ? headingId : undefined}
      className={cn(
        "mx-0 min-w-0 pt-5.5 @container",
        ruled && "border-t border-border-quiet",
        className,
      )}
    >
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <MonoLabel
          {...label}
          as={headingLevel ? (headingLevel === 2 ? "h2" : "h3") : "p"}
          id={headingLevel ? headingId : undefined}
        />
        {meta != null || status != null ? (
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-6 gap-y-2">
            {meta != null ? <MonoLabel as="div">{meta}</MonoLabel> : null}
            {status != null ? (
              <MonoLabel as="div" className="flex" aria-live="polite">
                {status}
              </MonoLabel>
            ) : null}
          </div>
        ) : null}
      </header>
      {children}
    </Element>
  );
}
