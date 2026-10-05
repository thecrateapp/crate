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
  sm: "h-7 gap-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5",
  md: "h-9 gap-1.5 px-3.5 text-sm [&_svg:not([class*='size-'])]:size-4",
};

const SELECTED_CLASS_NAME: Record<SegmentedControlVariant, string> = {
  solid: "bg-accent-action text-accent-action-foreground shadow-action",
  tonal: "bg-accent-action/12 text-accent-action",
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
        "items-center gap-1 rounded-full p-1",
        fullWidth ? "flex w-full" : "inline-flex",
        variant === "solid"
          ? "border border-border-subtle bg-surface-control"
          : "bg-transparent",
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
            data-state={selected ? "active" : "inactive"}
            onClick={() => {
              if (!selected) onValueChange(item.value);
            }}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "relative inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full font-medium outline-none transition-[color,background-color,box-shadow] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:pointer-events-none disabled:opacity-50",
              "after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 pointer-fine:after:hidden",
              SIZE_CLASS_NAME[size],
              fullWidth && "flex-1",
              selected
                ? SELECTED_CLASS_NAME[variant]
                : "text-text-secondary hover:text-text-primary",
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
