import { useRef, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@crate/ui/lib/cn";

export type SegmentedControlVariant = "solid" | "tonal";
export type SegmentedControlSize = "sm" | "md";
export type SegmentedControlRole = "tabs" | "radio";

export interface SegmentedControlItem<T extends string = string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
  controls?: string;
}

export interface SegmentedControlProps<T extends string = string> {
  items: readonly SegmentedControlItem<T>[];
  value: T;
  onValueChange: (value: T) => void;
  variant?: SegmentedControlVariant;
  size?: SegmentedControlSize;
  as?: SegmentedControlRole;
  label?: string;
  fullWidth?: boolean;
  className?: string;
  itemClassName?: string;
}

const SIZE_CLASS_NAME: Record<SegmentedControlSize, string> = {
  sm: "gap-1 px-2.5 [&_svg:not([class*='size-'])]:size-3.5",
  md: "gap-1.5 px-3 [&_svg:not([class*='size-'])]:size-4",
};

export function SegmentedControl<T extends string = string>({
  items,
  value,
  onValueChange,
  variant = "solid",
  size = "md",
  as = "tabs",
  label,
  fullWidth = false,
  className,
  itemClassName,
}: SegmentedControlProps<T>) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = items.findIndex((item) => item.value === value);
  const focusableIndex =
    selectedIndex >= 0 && !items[selectedIndex]?.disabled
      ? selectedIndex
      : items.findIndex((item) => !item.disabled);

  const moveTo = (index: number) => {
    const item = items[index];
    if (!item) return;
    itemRefs.current[index]?.focus();
    if (item.value !== value) onValueChange(item.value);
  };

  const findEnabled = (start: number, step: 1 | -1) => {
    const count = items.length;
    for (let offset = 1; offset <= count; offset += 1) {
      const index = (((start + step * offset) % count) + count) % count;
      if (!items[index]?.disabled) return index;
    }
    return -1;
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let next = -1;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = findEnabled(index, 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = findEnabled(index, -1);
        break;
      case "Home":
        next = items.findIndex((item) => !item.disabled);
        break;
      case "End":
        next = findEnabled(0, -1);
        break;
      default:
        return;
    }
    event.preventDefault();
    if (next >= 0) moveTo(next);
  };

  const isTabs = as === "tabs";

  return (
    <div
      role={isTabs ? "tablist" : "radiogroup"}
      aria-label={label}
      aria-orientation={isTabs ? "horizontal" : undefined}
      data-slot="segmented-control"
      data-variant={variant}
      data-size={size}
      className={cn(
        "flex-wrap items-center gap-2",
        fullWidth ? "flex w-full" : "inline-flex",
        className,
      )}
    >
      {items.map((item, index) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            type="button"
            role={isTabs ? "tab" : "radio"}
            aria-selected={isTabs ? selected : undefined}
            aria-checked={isTabs ? undefined : selected}
            aria-controls={isTabs ? item.controls : undefined}
            aria-label={item.ariaLabel}
            tabIndex={index === focusableIndex ? 0 : -1}
            disabled={item.disabled}
            data-slot="chip"
            data-state={selected ? "active" : "inactive"}
            onClick={() => {
              if (!selected) onValueChange(item.value);
            }}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "crate-form-chip relative inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full border py-1 font-mono text-filter-chip tracking-chip disabled:pointer-events-none disabled:opacity-50",
              SIZE_CLASS_NAME[size],
              fullWidth && "flex-1",
              itemClassName,
            )}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
