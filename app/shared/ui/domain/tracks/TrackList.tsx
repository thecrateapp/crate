import type {
  ComponentPropsWithRef,
  ComponentType,
  Key,
  ReactNode,
} from "react";

import { cn } from "@crate/ui/lib/cn";

export const TRACK_LIST_VIRTUALIZE_THRESHOLD = 80;

export interface TrackListVirtualListProps<T> {
  items: T[];
  itemKey?: (item: T, index: number) => Key;
  renderItem: (item: T, index: number) => ReactNode;
  estimateSize?: number;
  overscan?: number;
}

export interface TrackListProps<T>
  extends Omit<ComponentPropsWithRef<"div">, "children"> {
  items: T[];
  itemKey: (item: T, index: number) => Key;
  renderRow: (item: T, index: number) => ReactNode;
  virtualList?: ComponentType<TrackListVirtualListProps<T>>;
  virtualizeThreshold?: number;
  estimateSize?: number;
  overscan?: number;
  header?: ReactNode;
  empty?: ReactNode;
  label?: string;
  labelledBy?: string;
  className?: string;
}

export function TrackList<T>({
  items,
  itemKey,
  renderRow,
  virtualList: VirtualList,
  virtualizeThreshold = TRACK_LIST_VIRTUALIZE_THRESHOLD,
  estimateSize,
  overscan,
  header,
  empty,
  label,
  labelledBy,
  className,
  ...props
}: TrackListProps<T>) {
  const name = label ?? props["aria-label"];
  const heading = labelledBy ?? props["aria-labelledby"];
  const isEmpty = items.length === 0;
  const virtualized =
    VirtualList !== undefined && items.length >= virtualizeThreshold;

  return (
    <div
      {...props}
      data-slot="track-list"
      role={props.role ?? (name || heading ? "group" : undefined)}
      aria-label={name}
      aria-labelledby={heading}
      data-testid="track-list"
      data-virtualized={virtualized || undefined}
      className={cn("crate-track-list min-w-0", className)}
    >
      {!isEmpty ? header : null}
      {isEmpty ? (
        (empty ?? null)
      ) : virtualized && VirtualList ? (
        <VirtualList
          items={items}
          itemKey={itemKey}
          renderItem={renderRow}
          estimateSize={estimateSize}
          overscan={overscan}
        />
      ) : (
        <div className="space-y-[var(--content-list-gap)]">
          {items.map((item, index) => (
            <div key={itemKey(item, index)}>{renderRow(item, index)}</div>
          ))}
        </div>
      )}
    </div>
  );
}
