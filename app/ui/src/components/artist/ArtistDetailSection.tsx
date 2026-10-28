import { useId, type ReactNode } from "react";
import { cn } from "@crate/ui/lib/cn";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

interface ArtistDetailSectionProps {
  title: string;
  count?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  ruled?: boolean;
  headingLevel?: 2 | 3;
  children: ReactNode;
  className?: string;
}

/** Artist tabs share one caption/control row and content rhythm. */
export function ArtistDetailSection({
  title,
  count,
  description,
  actions,
  ruled = false,
  headingLevel = 2,
  children,
  className,
}: ArtistDetailSectionProps) {
  const headingId = useId();
  const descriptionId = useId();
  const hasDescription =
    description != null && description !== false && description !== "";

  return (
    <section
      aria-labelledby={headingId}
      aria-describedby={hasDescription ? descriptionId : undefined}
      data-slot="artist-detail-section"
      className={cn(
        "min-w-0",
        ruled && "border-t border-border-quiet pt-6",
        className,
      )}
    >
      <header
        data-slot="artist-detail-header"
        className="mb-3 flex min-h-11 min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-3"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <MonoLabel
            as={headingLevel === 2 ? "h2" : "h3"}
            id={headingId}
            tone="accent"
          >
            {title}
          </MonoLabel>
          {count != null ? (
            <InfoBadge variant="counter">{count}</InfoBadge>
          ) : null}
        </div>
        {actions != null ? (
          <div
            data-slot="artist-detail-actions"
            className="flex min-w-0 max-w-full flex-wrap items-center gap-2"
          >
            {actions}
          </div>
        ) : null}
      </header>
      <div data-slot="artist-detail-body" className="min-w-0">
        {hasDescription ? (
          <div
            id={descriptionId}
            className="mb-4 max-w-3xl text-sm text-text-muted"
          >
            {description}
          </div>
        ) : null}
        {children}
      </div>
    </section>
  );
}
