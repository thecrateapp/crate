import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useVirtualizer, useWindowVirtualizer } from "@tanstack/react-virtual";
import {
  CONTENT_DENSITY_METRICS,
  useContentDensity,
} from "@/lib/content-density";
import {
  getListenViewportScrollElement,
  getListenViewportScrollTop,
  usesListenRootScrollContainer,
} from "@/lib/viewport-scroll";

interface WindowVirtualListProps<T> {
  items: T[];
  estimateSize?: number;
  overscan?: number;
  itemKey?: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number) => ReactNode;
}

export function WindowVirtualList<T>({
  items,
  estimateSize,
  overscan = 8,
  itemKey,
  renderItem,
}: WindowVirtualListProps<T>) {
  const density = useContentDensity();
  const resolvedEstimateSize =
    estimateSize ?? CONTENT_DENSITY_METRICS[density].rowEstimate;
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const getItemKey = useCallback(
    (index: number) => {
      const item = items[index];
      return item && itemKey ? itemKey(item, index) : index;
    },
    [itemKey, items],
  );
  const usesRootScrollContainer = usesListenRootScrollContainer();
  const windowVirtualizer = useWindowVirtualizer({
    count: usesRootScrollContainer ? 0 : items.length,
    estimateSize: () => resolvedEstimateSize,
    overscan,
    scrollMargin,
    getItemKey,
  });
  const rootVirtualizer = useVirtualizer({
    count: usesRootScrollContainer ? items.length : 0,
    estimateSize: () => resolvedEstimateSize,
    overscan,
    scrollMargin,
    getItemKey,
    getScrollElement: getListenViewportScrollElement,
    initialOffset: getListenViewportScrollTop,
  });
  const virtualizer = usesRootScrollContainer
    ? rootVirtualizer
    : windowVirtualizer;

  useLayoutEffect(() => {
    virtualizer.measure();
  }, [resolvedEstimateSize, virtualizer]);

  useLayoutEffect(() => {
    const node = listRef.current;
    if (!node) return;

    const measure = () => {
      setScrollMargin(
        node.getBoundingClientRect().top + getListenViewportScrollTop(),
      );
    };
    measure();

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    resizeObserver?.observe(node);
    window.addEventListener("resize", measure, { passive: true });

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [items.length]);

  return (
    <div
      ref={listRef}
      className="relative"
      style={{
        height: `${virtualizer.getTotalSize()}px`,
        contain: "layout paint style",
      }}
    >
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const item = items[virtualRow.index];
        if (!item) return null;
        return (
          <div
            key={virtualRow.key}
            ref={virtualizer.measureElement}
            data-index={virtualRow.index}
            className="absolute left-0 top-0 w-full pb-1"
            style={{
              transform: `translateY(${virtualRow.start - scrollMargin}px)`,
            }}
          >
            {renderItem(item, virtualRow.index)}
          </div>
        );
      })}
    </div>
  );
}
