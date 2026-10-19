import {
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ComponentProps,
} from "react";
import { CRATE_ICON_SIZE, ChevronDown, Search } from "@crate/ui/icons";

import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { Input } from "@crate/ui/shadcn/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@crate/ui/shadcn/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SELECT_TRIGGER_BASE_CLASS,
} from "@crate/ui/shadcn/select";
import { cn } from "@crate/ui/lib/cn";

export interface AdminSelectOption {
  value: string;
  label: string;
  count?: number | string | null;
  searchText?: string;
}

interface AdminSelectProps
  extends Pick<
    ComponentProps<"button">,
    | "id"
    | "aria-describedby"
    | "aria-labelledby"
    | "aria-invalid"
    | "aria-required"
  > {
  value: string;
  onChange: (value: string) => void;
  options: AdminSelectOption[];
  placeholder: string;
  allowClear?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  noMatchesLabel?: string;
  triggerClassName?: string;
  menuClassName?: string;
  disabled?: boolean;
}

const DEFAULT_TRIGGER_CLASS = "min-w-[140px] max-w-[220px] px-4";

export function AdminSelect({
  value,
  onChange,
  options,
  placeholder,
  allowClear = true,
  searchable = false,
  searchPlaceholder = "Search...",
  noMatchesLabel = "No matches",
  triggerClassName,
  menuClassName,
  disabled = false,
  id,
  ...triggerProps
}: AdminSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const generatedTriggerId = useId();
  const triggerId = id ?? generatedTriggerId;
  const listboxId = `${triggerId}-listbox`;
  const searchRef = useRef<HTMLInputElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const filteredOptions = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter((option) => {
      const haystack = `${option.label} ${
        option.searchText ?? ""
      }`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [options, search]);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedLabel = options[selectedIndex]?.label ?? placeholder;
  const setMenuOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setSearch("");
  };

  if (!searchable) {
    const selectedKey =
      selectedIndex >= 0
        ? `option-${selectedIndex}`
        : allowClear && !value
          ? "clear"
          : "";

    return (
      <Select
        value={selectedKey}
        disabled={disabled}
        onValueChange={(nextKey) => {
          if (nextKey === "clear") {
            onChange("");
            return;
          }
          const option = options[Number(nextKey.slice("option-".length))];
          if (option) onChange(option.value);
        }}
      >
        <SelectTrigger
          {...triggerProps}
          id={triggerId}
          aria-label={placeholder}
          className={cn(DEFAULT_TRIGGER_CLASS, triggerClassName)}
        >
          <SelectValue placeholder={placeholder}>
            <span className="truncate">{selectedLabel}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          align="start"
          position="popper"
          className={cn("w-[240px]", menuClassName)}
        >
          {allowClear ? (
            <SelectItem value="clear" textValue={placeholder}>
              {placeholder}
            </SelectItem>
          ) : null}
          {options.length === 0 ? (
            <div
              role="status"
              className="px-2 py-4 text-center text-sm text-text-subtle"
            >
              {noMatchesLabel}
            </div>
          ) : null}
          {options.map((option, index) => (
            <SelectItem
              key={`option-${index}`}
              value={`option-${index}`}
              textValue={option.label}
            >
              <span className="min-w-0 flex-1 whitespace-normal break-words">
                {option.label}
              </span>
              {option.count != null ? (
                <span
                  data-slot="admin-select-count"
                  className="ml-auto font-mono text-label text-text-subtle tabular-nums"
                >
                  {option.count}
                </span>
              ) : null}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  const menuOptions: AdminSelectOption[] = allowClear
    ? [{ value: "", label: placeholder }, ...filteredOptions]
    : filteredOptions;
  const selectedMenuIndex = menuOptions.findIndex(
    (option) => option.value === value,
  );
  const focusOption = (index: number) => {
    optionRefs.current[index]?.focus();
  };
  const selectOption = (index: number) => {
    const option = menuOptions[index];
    if (!option) return;
    onChange(option.value);
    setMenuOpen(false);
  };
  const handleOptionKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusOption((index + 1) % menuOptions.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusOption((index - 1 + menuOptions.length) % menuOptions.length);
        break;
      case "Home":
        event.preventDefault();
        focusOption(0);
        break;
      case "End":
        event.preventDefault();
        focusOption(menuOptions.length - 1);
        break;
      case " ":
      case "Enter":
        event.preventDefault();
        selectOption(index);
        break;
    }
  };

  return (
    <Popover open={open && !disabled} onOpenChange={setMenuOpen}>
      <PopoverTrigger asChild>
        <button
          {...triggerProps}
          id={triggerId}
          type="button"
          role="combobox"
          aria-label={placeholder}
          aria-expanded={open && !disabled}
          aria-controls={listboxId}
          aria-haspopup="listbox"
          data-slot="select-trigger"
          data-placeholder={selectedIndex < 0 || undefined}
          disabled={disabled}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setMenuOpen(true);
            }
          }}
          className={cn(
            SELECT_TRIGGER_BASE_CLASS,
            DEFAULT_TRIGGER_CLASS,
            triggerClassName,
          )}
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronDown
            aria-hidden="true"
            size={CRATE_ICON_SIZE.sm}
            className="ml-auto shrink-0 text-text-subtle"
          />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        layer="dropdown"
        sideOffset={8}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchRef.current?.focus();
        }}
        className={cn("w-[240px] overflow-hidden p-2", menuClassName)}
      >
        <div className="border-b border-border-quiet-subtle px-1 pb-2">
          <div className="relative">
            <Search
              aria-hidden="true"
              size={CRATE_ICON_SIZE.sm}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle"
            />
            <Input
              ref={searchRef}
              type="search"
              role="searchbox"
              aria-label={searchPlaceholder}
              aria-controls={listboxId}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229)
                  return;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  focusOption(
                    event.key === "ArrowDown" ? 0 : menuOptions.length - 1,
                  );
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  if (filteredOptions.length > 0) {
                    selectOption(allowClear ? 1 : 0);
                  }
                }
              }}
              placeholder={searchPlaceholder}
              className="pl-9"
            />
          </div>
        </div>

        <div
          id={listboxId}
          role="listbox"
          aria-label={placeholder}
          className="max-h-[220px] overflow-y-auto p-1"
        >
          {menuOptions.map((option, index) => (
            <button
              type="button"
              key={`${index}:${option.value}`}
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              role="option"
              aria-selected={index === selectedMenuIndex}
              tabIndex={-1}
              data-state={index === selectedMenuIndex ? "checked" : "unchecked"}
              onClick={() => selectOption(index)}
              onKeyDown={(event) => handleOptionKeyDown(event, index)}
              className="crate-overlay-menu-item crate-focus-inset flex w-full items-center gap-2 px-3 text-left"
            >
              <span className="min-w-0 flex-1 whitespace-normal break-words">
                {option.label}
              </span>
              {option.count != null ? (
                <span
                  data-slot="admin-select-count"
                  className="ml-auto font-mono text-label text-text-subtle tabular-nums"
                >
                  {option.count}
                </span>
              ) : null}
              {index === selectedMenuIndex ? (
                <StatusDot className="ml-auto" />
              ) : null}
            </button>
          ))}
        </div>
        {filteredOptions.length === 0 ? (
          <p
            role="status"
            className="px-2 py-4 text-center text-sm text-text-subtle"
          >
            {noMatchesLabel}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
