import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@crate/ui/lib/cn";

/** Incoming release row aligned with ShowCard: the same cover, date, rules and responsive action position. */
export function EventRow({
  artwork,
  date,
  actions,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  artwork: ReactNode;
  date: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      {...props}
      data-slot="event-row"
      className={cn(
        "@container relative w-full min-w-0 overflow-hidden rounded-md border border-border-quiet bg-transparent",
        className,
      )}
    >
      <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)_3rem] items-center gap-x-3 gap-y-2 pr-2 @xl:grid-cols-[5.5rem_minmax(0,1fr)_3rem_auto]">
        <div
          data-slot="event-artwork"
          className="col-start-1 row-start-1 relative size-22 overflow-hidden bg-surface-control"
        >
          {artwork}
        </div>
        <div
          data-slot="event-content"
          className="col-start-2 row-start-1 min-w-0 py-2"
        >
          {children}
        </div>
        <div className="col-start-3 row-start-1">{date}</div>
        {actions ? (
          <div
            data-slot="event-actions"
            className="col-start-2 col-end-4 flex max-w-full justify-end pb-2 @xl:pb-0 @xl:col-start-4 @xl:col-end-5 @xl:row-start-1"
          >
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
