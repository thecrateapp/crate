import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { useState, useRef, useEffect, useEffectEvent, useId } from "react";
import { useNavigate } from "react-router";
import { Loader2, Search, X } from "lucide-react";

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@crate/ui/shadcn/popover";
import { api } from "@/lib/api";
import {
  albumCoverApiUrl,
  albumPagePath,
  artistPagePath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";

interface LocalResults {
  artists: { id?: number; entity_uid?: string; slug?: string; name: string }[];
  albums: {
    id?: number;
    entity_uid?: string;
    slug?: string;
    artist: string;
    artist_id?: number;
    artist_entity_uid?: string;
    artist_slug?: string;
    name: string;
  }[];
  tracks: {
    title: string;
    artist: string;
    album: string;
    artist_entity_uid?: string;
    album_id?: number;
    album_entity_uid?: string;
    album_slug?: string;
  }[];
}

interface ResultItem {
  type: "artist" | "album" | "track";
  label: string;
  sublabel: string;
  path: string;
  imageUrl?: string;
}

interface SearchBarProps {
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onQueryChange?: (query: string) => void;
  onNavigate?: () => void;
}

const RECENTS_KEY = "search-recents:v1";
const LEGACY_RECENTS_KEY = "search-recents";
const MAX_RECENTS = 5;

export function loadSearchRecents(): string[] {
  try {
    const currentRaw = localStorage.getItem(RECENTS_KEY);
    const legacyRaw = currentRaw
      ? null
      : localStorage.getItem(LEGACY_RECENTS_KEY);
    const raw = currentRaw ?? legacyRaw;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const recents = parsed
      .filter((entry): entry is string => typeof entry === "string")
      .slice(0, MAX_RECENTS);
    if (legacyRaw) {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
      localStorage.removeItem(LEGACY_RECENTS_KEY);
    }
    return recents;
  } catch {
    return [];
  }
}

function saveRecent(query: string) {
  const recents = loadSearchRecents().filter(
    (recent) => recent.toLowerCase() !== query.toLowerCase(),
  );
  recents.unshift(query);
  localStorage.setItem(
    RECENTS_KEY,
    JSON.stringify(recents.slice(0, MAX_RECENTS)),
  );
}

function SearchResultThumb({ item }: { item: ResultItem }) {
  if (item.imageUrl) {
    return (
      <img
        src={item.imageUrl}
        alt=""
        className={`crate-media-thumbnail h-12 w-12 shrink-0 object-cover bg-canvas-surface ${
          item.type === "artist" ? "rounded-md" : "rounded"
        }`}
        onError={(event) => {
          (event.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  return null;
}

export function SearchBar({
  inputRef,
  onQueryChange,
  onNavigate,
}: SearchBarProps) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [localResults, setLocalResults] = useState<LocalResults | null>(null);
  const [open, setOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [recents, setRecents] = useState<string[]>(loadSearchRecents);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const localTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const localCacheRef = useRef<Map<string, LocalResults>>(new Map());
  const wrapperRef = useRef<HTMLDivElement>(null);
  const internalInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = inputRef ?? internalInputRef;
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const doLocalSearch = useEffectEvent(async (value: string) => {
    onQueryChange?.(value);
    if (value.length < 2) {
      setLocalResults(null);
      setLoading(false);
      return;
    }

    const cached = localCacheRef.current.get(value.toLowerCase());
    if (cached) {
      setLocalResults(cached);
      setOpen(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    const result = await api<LocalResults>(
      `/api/search?q=${encodeURIComponent(value)}`,
    ).catch(() => null);
    if (result) {
      localCacheRef.current.set(value.toLowerCase(), result);
    }
    setLocalResults(result);
    setOpen(true);
    setLoading(false);
  });

  useEffect(() => {
    clearTimeout(localTimeoutRef.current);
    if (query.length < 2) {
      setLocalResults(null);
      setSelectedIdx(-1);
      if (query.length === 0) setLoading(false);
      if (query.length === 0) return;
    }

    localTimeoutRef.current = setTimeout(() => {
      void doLocalSearch(query);
    }, 200);

    return () => clearTimeout(localTimeoutRef.current);
  }, [query]);

  useEffect(() => {
    setSelectedIdx(-1);
  }, [localResults]);

  function addToRecents(value: string) {
    if (value.length < 2) return;
    saveRecent(value);
    setRecents(loadSearchRecents());
  }

  function go(path: string) {
    addToRecents(query);
    navigate(path);
    setQuery("");
    setOpen(false);
    setSelectedIdx(-1);
    onNavigate?.();
  }

  const items: ResultItem[] = [];
  if (localResults) {
    for (const artist of localResults.artists.slice(0, 4)) {
      items.push({
        type: "artist",
        label: artist.name,
        sublabel: "Artist",
        path: artistPagePath({
          artistId: artist.id,
          artistSlug: artist.slug,
          artistName: artist.name,
        }),
        imageUrl: artistPhotoApiUrl({
          artistId: artist.id,
          artistEntityUid: artist.entity_uid,
          artistSlug: artist.slug,
          artistName: artist.name,
        }),
      });
    }
    for (const album of localResults.albums.slice(0, 4)) {
      items.push({
        type: "album",
        label: album.name,
        sublabel: album.artist,
        path: albumPagePath({
          albumId: album.id,
          albumSlug: album.slug,
          artistName: album.artist,
          albumName: album.name,
        }),
        imageUrl: albumCoverApiUrl({
          albumId: album.id,
          albumEntityUid: album.entity_uid,
          artistEntityUid: album.artist_entity_uid,
          albumSlug: album.slug,
          artistName: album.artist,
          albumName: album.name,
        }),
      });
    }
    for (const track of (localResults.tracks ?? []).slice(0, 4)) {
      items.push({
        type: "track",
        label: track.title,
        sublabel: `${track.artist} — ${track.album}`,
        path: albumPagePath({
          albumId: track.album_id,
          albumSlug: track.album_slug,
          artistName: track.artist,
          albumName: track.album,
        }),
        imageUrl: albumCoverApiUrl({
          albumId: track.album_id,
          albumEntityUid: track.album_entity_uid,
          artistEntityUid: track.artist_entity_uid,
          albumSlug: track.album_slug,
          artistName: track.artist,
          albumName: track.album,
        }),
      });
    }
  }

  const showRecents = open && query.length === 0 && recents.length > 0;
  const showResults = open && query.length > 0 && (items.length > 0 || loading);
  const showNoResults =
    open && query.length >= 2 && !loading && localResults && items.length === 0;
  const navigableCount = showRecents ? recents.length : items.length;

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;

    if (
      event.key === "Tab" &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      const first = suggestionsRef.current?.querySelector<HTMLButtonElement>(
        "button:not([disabled])",
      );
      if (first) {
        event.preventDefault();
        first.focus();
        return;
      }
    }

    if (event.key === "Escape") {
      setOpen(false);
      return;
    }

    if (navigableCount === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIdx((prev) => (prev < navigableCount - 1 ? prev + 1 : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIdx((prev) => (prev > 0 ? prev - 1 : navigableCount - 1));
    } else if (event.key === "Enter" && selectedIdx >= 0) {
      event.preventDefault();
      if (showRecents) {
        const recent = recents[selectedIdx];
        if (recent) {
          setQuery(recent);
          setOpen(true);
        }
      } else {
        const item = items[selectedIdx];
        if (item) go(item.path);
      }
    }
  }

  function handleFocus() {
    if (query.length === 0 && recents.length > 0) {
      setRecents(loadSearchRecents());
      setOpen(true);
      setSelectedIdx(-1);
    } else if (localResults) {
      setOpen(true);
    }
  }

  function selectRecent(value: string) {
    setQuery(value);
    setOpen(true);
  }

  function handleSuggestionTab(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey)
      return;
    const buttons = suggestionsRef.current?.querySelectorAll<HTMLButtonElement>(
      "button:not([disabled])",
    );
    if (!buttons?.length) return;
    if (event.shiftKey && event.target === buttons[0]) {
      event.preventDefault();
      event.stopPropagation();
      searchInputRef.current?.focus();
    } else if (
      !event.shiftKey &&
      event.target === buttons[buttons.length - 1]
    ) {
      // Restore the DOM tab starting point, then let native Tab reach the next control.
      // Capture avoids Radix FocusScope's result-to-result loop at this boundary.
      event.stopPropagation();
      searchInputRef.current?.focus();
      setOpen(false);
    }
  }

  return (
    <div ref={wrapperRef} className="relative min-w-0 w-full">
      <Popover
        open={showResults || showRecents || Boolean(showNoResults)}
        onOpenChange={setOpen}
      >
        <PopoverAnchor asChild>
          <div className="relative md:origin-right md:transition-transform md:duration-300 md:ease-out md:focus-within:scale-x-[1.06]">
            <div className="relative flex items-center">
              <Search
                data-admin-ux="search-field"
                aria-hidden="true"
                size={17}
                className="pointer-events-none absolute left-4 text-text-subtle"
              />
              {loading ? (
                <Loader2
                  data-admin-ux="search-loading"
                  aria-hidden="true"
                  size={15}
                  className="absolute right-4 animate-spin text-text-subtle"
                />
              ) : null}
              {!loading && query ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setLocalResults(null);
                    searchInputRef.current?.focus();
                  }}
                  className="absolute right-0.5 grid size-11 place-items-center text-text-subtle transition-colors hover:text-text-secondary"
                  aria-label="Clear search"
                >
                  <X
                    data-admin-ux="search-clear"
                    aria-hidden="true"
                    size={15}
                  />
                </button>
              ) : null}
              <label htmlFor={inputId} className="sr-only">
                Search library
              </label>
              <input
                ref={searchInputRef}
                id={inputId}
                type="text"
                aria-busy={loading || undefined}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setOpen(true);
                }}
                onFocus={handleFocus}
                onKeyDown={handleKeyDown}
                placeholder="Search library…"
                className="h-12 w-full rounded-md border border-border-quiet bg-canvas-surface pl-11 pr-12 text-[15px] text-text-primary transition-[background-color,border-color,box-shadow] placeholder:text-text-subtle focus:border-accent-action/25 focus:bg-canvas-surface"
              />
            </div>
          </div>
        </PopoverAnchor>
        <PopoverContent
          ref={suggestionsRef}
          onKeyDownCapture={handleSuggestionTab}
          role="region"
          aria-label="Library search suggestions"
          layer="dropdown"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          className="max-h-[min(20rem,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] overflow-y-auto p-0"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            searchInputRef.current?.focus();
            setOpen(false);
          }}
          onInteractOutside={(event) => {
            if (wrapperRef.current?.contains(event.target as Node))
              event.preventDefault();
          }}
        >
          {showResults ? (
            <div className="py-1">
              <MonoLabel tone="accent" className="px-3 py-2">
                In Library
              </MonoLabel>
              {items.map((item, index) => (
                <button
                  key={`${item.type}-${item.path}`}
                  type="button"
                  onClick={() => go(item.path)}
                  className={`group flex min-h-11 w-full items-center gap-3 border-l-2 px-3 py-2 text-left transition-colors hover:text-accent-action-hi focus-visible:text-accent-action-hi ${
                    index === selectedIdx
                      ? "border-accent-action-hi text-accent-action-hi"
                      : "border-transparent text-text-primary"
                  }`}
                >
                  <SearchResultThumb item={item} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-caption text-inherit">
                      {item.label}
                    </p>
                    <p className="truncate text-xs text-text-subtle">
                      {item.sublabel}
                    </p>
                  </div>
                  <MonoLabel as="span" className="shrink-0">
                    {item.type}
                  </MonoLabel>
                </button>
              ))}
            </div>
          ) : null}

          {showRecents ? (
            <div className="py-1">
              <MonoLabel tone="accent" className="px-3 py-2">
                Recent
              </MonoLabel>
              {recents.map((recent, index) => (
                <button
                  key={recent}
                  type="button"
                  onClick={() => selectRecent(recent)}
                  className={`group flex min-h-11 w-full items-center gap-3 border-l-2 px-3 py-2 text-left transition-colors hover:text-accent-action-hi focus-visible:text-accent-action-hi ${
                    index === selectedIdx
                      ? "border-accent-action-hi text-accent-action-hi"
                      : "border-transparent text-text-primary"
                  }`}
                >
                  <span className="truncate text-caption text-inherit">
                    {recent}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {showNoResults ? (
            <div className="py-6 text-center">
              <div className="flex items-center justify-center gap-2 text-sm text-text-muted">
                No library matches
              </div>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  );
}
