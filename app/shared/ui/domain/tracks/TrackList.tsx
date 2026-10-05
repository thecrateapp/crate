import type { ComponentType, Key, ReactNode } from "react";

import { cn } from "@crate/ui/lib/cn";

export const TRACK_LIST_VIRTUALIZE_THRESHOLD = 80;

export interface TrackListVirtualListProps<T> {
  items: T[];
  itemKey?: (item: T, index: number) => Key;
  renderItem: (item: T, index: number) => ReactNode;
  estimateSize?: number;
  overscan?: number;
}

export interface TrackListProps<T> {
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
}: TrackListProps<T>) {
  const isEmpty = items.length === 0;
  const virtualized =
    VirtualList !== undefined && items.length >= virtualizeThreshold;

  return (
    <div
      role={label || labelledBy ? "group" : undefined}
      aria-label={label}
      aria-labelledby={labelledBy}
      data-testid="track-list"
      data-virtualized={virtualized || undefined}
      className={cn("min-w-0", className)}
    >
      {header && !isEmpty ? header : null}
      {isEmpty ? (
        empty ?? null
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
