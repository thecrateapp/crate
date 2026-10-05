import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentProps,
} from "react";

import { CRATE_ICON_SIZE, Search, X } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";
import { useDebouncedValue } from "@crate/ui/lib/use-debounced-value";
import { Input } from "@crate/ui/shadcn/input";

export interface SearchInputProps
  extends Omit<ComponentProps<"input">, "type" | "value" | "defaultValue"> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  onDebouncedChange?: (value: string) => void;
  debounceMs?: number;
  label?: string;
  clearable?: boolean;
  clearLabel?: string;
  onClear?: () => void;
  containerClassName?: string;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput(
    {
      value: controlledValue,
      defaultValue = "",
      onValueChange,
      onDebouncedChange,
      debounceMs = 300,
      label = "Search",
      clearable = true,
      clearLabel = "Clear search",
      onClear,
      onChange,
      className,
      containerClassName,
      disabled,
      ...props
    },
    ref,
  ) {
    const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
    const isControlled = controlledValue !== undefined;
    const value = isControlled ? controlledValue : uncontrolledValue;
    const pendingEmission = useMemo(() => ({ value }), [value]);
    const debouncedEmission = useDebouncedValue(pendingEmission, debounceMs);
    const lastEmittedRef = useRef(value);
    const onDebouncedChangeRef = useRef(onDebouncedChange);
    const innerRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
      onDebouncedChangeRef.current = onDebouncedChange;
    }, [onDebouncedChange]);

    useEffect(() => {
      const next = debouncedEmission.value;
      if (next === lastEmittedRef.current) return;
      lastEmittedRef.current = next;
      onDebouncedChangeRef.current?.(next);
    }, [debouncedEmission]);

    const setValue = (next: string) => {
      if (!isControlled) setUncontrolledValue(next);
      onValueChange?.(next);
    };

    const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
      onChange?.(event);
      setValue(event.target.value);
    };

    const handleClear = () => {
      setValue("");
      if (lastEmittedRef.current !== "") {
        lastEmittedRef.current = "";
        onDebouncedChangeRef.current?.("");
      }
      onClear?.();
      innerRef.current?.focus();
    };

    const showClear = clearable && value.length > 0 && !disabled;

    return (
      <div
        data-slot="search-input"
        className={cn("relative w-full", containerClassName)}
      >
        <Search
          aria-hidden="true"
          size={CRATE_ICON_SIZE.sm}
          className="pointer-events-none absolute top-1/2 left-3.5 z-10 -translate-y-1/2 text-text-muted"
        />
        <Input
          ref={(node) => {
            innerRef.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
          }}
          type="search"
          aria-label={label}
          value={value}
          onChange={handleChange}
          disabled={disabled}
          className={cn(
            "pl-10 [&::-webkit-search-cancel-button]:appearance-none",
            showClear && "pr-10",
            className,
          )}
          {...props}
        />
        {showClear ? (
          <button
            type="button"
            aria-label={clearLabel}
            title={clearLabel}
            onClick={handleClear}
            className="absolute top-1/2 right-2 z-10 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-text-muted outline-none transition-colors hover:text-text-primary focus-visible:shadow-focus"
          >
            <X aria-hidden="true" size={CRATE_ICON_SIZE.sm} />
          </button>
        ) : null}
      </div>
    );
  },
);
