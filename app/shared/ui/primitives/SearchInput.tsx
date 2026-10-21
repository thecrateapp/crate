import { TooltipHint } from "@crate/ui/shadcn/tooltip";
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
      onCompositionStart,
      onCompositionEnd,
      className,
      containerClassName,
      disabled,
      readOnly,
      ...props
    },
    ref,
  ) {
    const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
    const [composing, setComposing] = useState(false);
    const isControlled = controlledValue !== undefined;
    const value = isControlled ? controlledValue : uncontrolledValue;
    const pendingEmission = useMemo(
      () => ({ value, composing }),
      [value, composing],
    );
    const debouncedEmission = useDebouncedValue(pendingEmission, debounceMs);
    const lastEmittedRef = useRef(value);
    const onDebouncedChangeRef = useRef(onDebouncedChange);
    const innerRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
      onDebouncedChangeRef.current = onDebouncedChange;
    }, [onDebouncedChange]);

    useEffect(() => {
      if (debouncedEmission.composing) return;
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

    const showClear = clearable && value.length > 0 && !disabled && !readOnly;

    return (
      <div
        data-slot="search-input"
        className={cn("relative w-full", containerClassName)}
      >
        <Search
          aria-hidden="true"
          size={CRATE_ICON_SIZE.sm}
          className="pointer-events-none absolute top-1/2 left-3.5 z-10 -translate-y-1/2 text-text-subtle"
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
          onCompositionStart={(event) => {
            setComposing(true);
            onCompositionStart?.(event);
          }}
          onCompositionEnd={(event) => {
            setComposing(false);
            onCompositionEnd?.(event);
          }}
          disabled={disabled}
          readOnly={readOnly}
          className={cn(
            "pl-10 [&::-webkit-search-cancel-button]:appearance-none",
            showClear && "pr-11 pointer-coarse:pr-12",
            className,
          )}
          {...props}
        />
        {showClear ? (
          <TooltipHint content={clearLabel}>
            <button
              type="button"
              aria-label={clearLabel}
              onClick={handleClear}
              className="crate-form-search-clear absolute top-1/2 right-1 z-10 inline-flex -translate-y-1/2 items-center justify-center rounded-full text-text-subtle transition-colors hover:text-text-primary"
            >
              <X aria-hidden="true" size={CRATE_ICON_SIZE.sm} />
            </button>
          </TooltipHint>
        ) : null}
      </div>
    );
  },
);
