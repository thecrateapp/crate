// Fixture state only. Production controllers are exercised separately in Listen's browser fixture.
import { useEffect, useId, useRef, useState } from "react";
import { TopBarSearchDropdownView } from "../../../app/listen/src/components/layout/topbar/TopBarSearchDropdownView";
import { FormField } from "@crate/ui/primitives/FormField";
import { SearchInput } from "@crate/ui/primitives/SearchInput";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@crate/ui/shadcn/select";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
import english from "../../../app/listen/src/i18n/catalogs/en.json";
const items = Array.from({ length: 12 }, (_, index) => ({
  type: "album",
  label: index === 0 ? "Luz de octubre" : `Collection ${index + 1}`,
  sublabel: "Costa Norte",
  origin: index === 1 ? "remote" : "local",
}));
const recents = [
  { type: "album", label: "Costa de noche" },
  { type: "artist", label: "Costa Norte" },
];
const t = (key: string, options?: { query: string }) =>
  (english[key as keyof typeof english] ?? key).replace(
    "{query}",
    options?.query ?? "",
  );
export function SearchLayersReview() {
  const [mode, setMode] = useState("results");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActive] = useState(-1);
  const [action, setAction] = useState("No result selected.");
  const anchor = useRef<HTMLDivElement>(null),
    panel = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  useDismissibleLayer({
    active: open,
    refs: [anchor, panel],
    onDismiss: () => setOpen(false),
  });
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (rect)
        setPosition({
          left: rect.left,
          top: rect.bottom + 4,
          width: rect.width,
          maxHeight: Math.max(0, window.innerHeight - rect.bottom - 12),
        });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);
  const results = mode === "results" ? items : [];
  const select = (label: string) => {
    setAction(`Selected ${label}.`);
    setOpen(false);
    input.current?.focus();
  };
  return (
    <div className="grid min-w-0 gap-4">
      <FormField label="Search feedback state">
        {(control) => (
          <Select
            value={mode}
            onValueChange={(value) => {
              setMode(value);
              setActive(-1);
              setOpen(false);
            }}
          >
            <SelectTrigger {...control}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {["results", "recent", "loading", "empty", "error"].map(
                (value) => (
                  <SelectItem value={value} key={value}>
                    {value[0]!.toUpperCase() + value.slice(1)}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        )}
      </FormField>
      <div ref={anchor}>
        <FormField label="Review search">
          {(control) => (
            <SearchInput
              {...control}
              ref={input}
              value={query}
              role="combobox"
              aria-expanded={open}
              aria-controls={open ? listboxId : undefined}
              aria-activedescendant={
                open && activeIdx >= 0 ? `${listboxId}-${activeIdx}` : undefined
              }
              placeholder="Search local review data"
              onFocus={() => setOpen(true)}
              onValueChange={(value) => {
                setQuery(value);
                setActive(-1);
                setOpen(true);
              }}
              onKeyDown={(event) => {
                const count =
                  mode === "recent" ? recents.length : results.length;
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActive((index) => Math.min(index + 1, count - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive((index) => Math.max(index - 1, -1));
                } else if (event.key === "Enter" && activeIdx >= 0) {
                  event.preventDefault();
                  select(
                    (mode === "recent" ? recents : results)[activeIdx]!.label,
                  );
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setOpen(false);
                }
              }}
            />
          )}
        </FormField>
      </div>
      {open && position ? (
        <TopBarSearchDropdownView
          listboxId={listboxId}
          dropdownRef={panel}
          dropdownStyle={position}
          loading={mode === "loading"}
          visibility={{
            showResults: mode !== "recent",
            showRecents: mode === "recent",
            showSearchError: mode === "error",
            showEmptyResults: mode === "empty",
          }}
          results={results}
          recents={recents}
          activeIdx={activeIdx}
          trimmedQuery={query.trim()}
          searchError="Try again without losing the query."
          onSelectItem={async (item) => select(item.label)}
          onSelectRecent={(item) => select(item.label)}
          onSeeAllResults={() => select(`all results for ${query}`)}
          t={t}
          renderThumb={(item) => (
            <MediaCover
              alt=""
              fallback={item.label.slice(0, 2)}
              className="size-12 shrink-0"
            />
          )}
        />
      ) : null}
      <output aria-label="Search review action">{action}</output>
      <p className="text-sm text-text-muted">
        Choose a state, then focus the search. Results, recent history, reserved
        loading, empty and error use Listen's actual presentation and shared
        feedback components. Local fixture data; no network calls.
      </p>
    </div>
  );
}
