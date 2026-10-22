import type { ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "../../lib/cn";

/** Shared 88px media row for Listen's and Admin's upcoming show/release lists. */
export function UpcomingEventRow({
  artwork,
  details,
  date,
  actions,
  href,
  openLabel,
  onToggle,
  expanded,
  className,
  actionsClassName,
}: {
  artwork: ReactNode;
  details: ReactNode;
  date: ReactNode;
  actions: ReactNode;
  href?: string | null;
  openLabel?: string;
  onToggle?: () => void;
  expanded?: boolean;
  className?: string;
  actionsClassName?: string;
}) {
  const content = (
    <>
      {artwork}
      <span className="block min-w-0 flex-1 px-3 py-2.5">{details}</span>
    </>
  );
  const identityClass =
    "flex min-w-0 flex-1 items-center text-left crate-focus-inset";

  return (
    <div
      data-slot="upcoming-event-row"
      className={cn(
        "flex min-h-[88px] min-w-0 items-center bg-surface-object",
        className,
      )}
    >
      {onToggle ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
          className={identityClass}
        >
          {content}
        </button>
      ) : href ? (
        <Link to={href} aria-label={openLabel} className={identityClass}>
          {content}
        </Link>
      ) : (
        <div className={identityClass}>{content}</div>
      )}
      <div data-slot="upcoming-event-date-slot" className="w-14 shrink-0">
        {date}
      </div>
      <div
        data-slot="upcoming-event-actions-slot"
        className={cn(
          "flex w-28 shrink-0 items-center justify-end",
          actionsClassName,
        )}
      >
        {actions}
      </div>
    </div>
  );
}
