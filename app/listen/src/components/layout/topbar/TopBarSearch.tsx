import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  CRATE_ICON_SIZE,
  Disc,
  Loader2,
  Music,
  Search,
  User,
  X,
} from "@crate/ui/icons";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import { AppPopover } from "@crate/ui/primitives/AppPopover";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { useHoverCapability } from "@/hooks/use-hover-capability";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { resolveRemotePlayableTrack } from "@/lib/remote-track-playback";

import {
  addTopBarSearchRecent,
  flattenTopBarSearchResults,
  getTopBarSearchRecents,
  type SearchResult,
  type TopBarSearchRecentEntry,
  type TopBarSearchItem,
} from "./topbar-search-model";

function SearchResultThumb({ item }: { item: TopBarSearchItem }) {
  if (item.imageUrl) {
    return (
      <img
        src={item.imageUrl}
        alt=""
        className={`h-8 w-8 shrink-0 object-cover bg-white/5 ${
          item.type === "artist" ? "rounded-full" : "rounded"
        }`}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  if (item.type === "artist") {
    return (
      <User
        size={CRATE_ICON_SIZE.md}
        className="h-8 w-8 shrink-0 rounded-full bg-white/5 p-1.5 text-white/30"
      />
    );
  }
  if (item.type === "album") {
    return (
      <Disc
        size={CRATE_ICON_SIZE.md}
        className="h-8 w-8 shrink-0 rounded bg-white/5 p-1.5 text-white/30"
      />
    );
  }
  return (
    <Music
      size={CRATE_ICON_SIZE.md}
      className="h-8 w-8 shrink-0 rounded bg-white/5 p-1.5 text-white/30"
    />
  );
}

function searchErrorHint(
  error: unknown,
  messages: { session: string; generic: string },
): string {
  if (
    error instanceof ApiError &&
    (error.status === 401 || error.status === 403)
  ) {
    return messages.session;
  }
  return messages.generic;
}

export function TopBarSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { play } = usePlayerActions();
  const canHover = useHoverCapability();
  const isDesktop = useIsDesktop();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TopBarSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [completedQuery, setCompletedQuery] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [recents, setRecents] = useState<TopBarSearchRecentEntry[]>(
    getTopBarSearchRecents,
  );
  const [expanded, setExpanded] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const collapseTimerRef = useRef<number | undefined>(undefined);
  const queryRef = useRef(query);
  const showDropdownRef = useRef(showDropdown);
  const [dropdownStyle, setDropdownStyle] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const trimmedQuery = query.trim();
  const queryActive = trimmedQuery.length > 0;
  const searchOpen = expanded || showDropdown || queryActive;

  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  useEffect(() => {
    showDropdownRef.current = showDropdown;
  }, [showDropdown]);

  const clearCollapseTimer = useCallback(() => {
    if (collapseTimerRef.current) {
      clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = undefined;
    }
  }, []);

  const focusInputSoon = useCallback(() => {
    clearCollapseTimer();
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [clearCollapseTimer]);

  const collapseIfIdle = useCallback((nextShowDropdown?: boolean) => {
    if (queryRef.current.trim()) return;
    if ((nextShowDropdown ?? showDropdownRef.current) === true) return;
    if (containerRef.current?.contains(document.activeElement)) return;
    setExpanded(false);
    setActiveIdx(-1);
  }, []);

  const scheduleCollapseIfIdle = useCallback(
    (nextShowDropdown?: boolean) => {
      clearCollapseTimer();
      collapseTimerRef.current = window.setTimeout(() => {
        collapseIfIdle(nextShowDropdown);
      }, 140);
    },
    [clearCollapseTimer, collapseIfIdle],
  );

  const openSearch = useCallback(
    (withDropdown = true) => {
      clearCollapseTimer();
      setExpanded(true);
      if (withDropdown) {
        setShowDropdown(true);
      }
    },
    [clearCollapseTimer],
  );

  useEffect(() => {
    return () => {
      clearCollapseTimer();
    };
  }, [clearCollapseTimer]);

  const updateDropdownPosition = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) {
      setDropdownStyle(null);
      return;
    }
    setDropdownStyle({
      left: rect.left,
      top: rect.bottom + 4,
      width: rect.width || containerRef.current?.offsetWidth || 384,
    });
  }, []);

  useLayoutEffect(() => {
    if (!showDropdown) {
      setDropdownStyle(null);
      return;
    }

    updateDropdownPosition();

    const handlePositionUpdate = () => {
      updateDropdownPosition();
    };

    window.addEventListener("resize", handlePositionUpdate);
    window.addEventListener("scroll", handlePositionUpdate, true);
    return () => {
      window.removeEventListener("resize", handlePositionUpdate);
      window.removeEventListener("scroll", handlePositionUpdate, true);
    };
  }, [showDropdown, updateDropdownPosition]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const requestQuery = query.trim();
    if (!requestQuery) {
      setResults([]);
      setLoading(false);
      setCompletedQuery(null);
      setSearchError(null);
      return;
    }

    setLoading(true);
    setCompletedQuery(null);
    setSearchError(null);
    debounceRef.current = setTimeout(() => {
      api<SearchResult>(
        `/api/catalog/search?q=${encodeURIComponent(requestQuery)}&limit=10`,
      )
        .then((data) => {
          if (queryRef.current.trim() !== requestQuery) return;
          setResults(flattenTopBarSearchResults(data));
          setActiveIdx(-1);
          setCompletedQuery(requestQuery);
          setSearchError(null);
        })
        .catch((error) => {
          if (queryRef.current.trim() !== requestQuery) return;
          setResults([]);
          setActiveIdx(-1);
          setCompletedQuery(requestQuery);
          setSearchError(
            searchErrorHint(error, {
              session: t("search.errors.sessionRefresh"),
              generic: t("search.errors.tryAgain"),
            }),
          );
        })
        .finally(() => {
          if (queryRef.current.trim() === requestQuery) {
            setLoading(false);
          }
        });
    }, 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, t]);

  useEffect(() => {
    if (query.trim()) {
      setExpanded(true);
      setShowDropdown(true);
    }
  }, [query]);

  const closeSearch = useCallback(() => {
    setShowDropdown(false);
    setQuery("");
    setResults([]);
    setCompletedQuery(null);
    setSearchError(null);
    setExpanded(false);
    setActiveIdx(-1);
    inputRef.current?.blur();
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeSearch();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeSearch, searchOpen]);

  useDismissibleLayer({
    active: showDropdown,
    refs: [containerRef, dropdownRef, inputRef],
    onDismiss: () => {
      setShowDropdown(false);
      scheduleCollapseIfIdle(false);
    },
    closeOnEscape: false,
  });

  const selectItem = useCallback(
    async (item: TopBarSearchItem) => {
      addTopBarSearchRecent(item);
      setRecents(getTopBarSearchRecents());
      if (item.trackData) {
        try {
          const resolved = await resolveRemotePlayableTrack({
            ...item.trackData,
            albumCover: item.imageUrl,
          });
          play(resolved, { type: "queue", name: "Search" });
        } catch {
          setSearchError(t("search.tryAgain"));
          return;
        }
      } else if (item.navigateTo) {
        navigate(item.navigateTo);
      }
      setShowDropdown(false);
      setQuery("");
      setExpanded(false);
      setCompletedQuery(null);
      setSearchError(null);
    },
    [navigate, play, t],
  );

  const selectRecent = useCallback(
    (recent: TopBarSearchRecentEntry) => {
      addTopBarSearchRecent(recent);
      setRecents(getTopBarSearchRecents());

      if (recent.navigateTo) {
        navigate(recent.navigateTo);
        setShowDropdown(false);
        setExpanded(false);
        setQuery("");
        setResults([]);
        setCompletedQuery(null);
        setSearchError(null);
        return;
      }

      setExpanded(true);
      setQuery(recent.label);
      setShowDropdown(true);
      focusInputSoon();
    },
    [focusInputSoon, navigate],
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const items = query.trim()
      ? results
      : recents.map((recent) => ({ type: recent.type, label: recent.label }));
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((prev) => Math.min(prev + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((prev) => Math.max(prev - 1, -1));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      if (query.trim() && results[activeIdx]) {
        void selectItem(results[activeIdx]);
      } else if (!query.trim() && recents[activeIdx]) {
        selectRecent(recents[activeIdx]);
      }
    } else if (e.key === "Escape") {
      closeSearch();
    }
  }

  const showRecents = showDropdown && !trimmedQuery && recents.length > 0;
  const showSearchError =
    showDropdown &&
    trimmedQuery.length > 0 &&
    !loading &&
    completedQuery === trimmedQuery &&
    Boolean(searchError);
  const showEmptyResults =
    showDropdown &&
    trimmedQuery.length > 0 &&
    !loading &&
    completedQuery === trimmedQuery &&
    !searchError &&
    results.length === 0;
  const showResults =
    showDropdown &&
    trimmedQuery.length > 0 &&
    (results.length > 0 || loading || showEmptyResults || showSearchError);
  const dropdown =
    dropdownStyle && (showResults || showRecents)
      ? createPortal(
          <AppPopover
            ref={dropdownRef}
            className={cn(
              "listen-glass-panel fixed max-h-80 overflow-y-auto rounded-2xl py-1",
              showRecents ? "max-h-none" : undefined,
            )}
            style={{
              left: dropdownStyle.left,
              top: dropdownStyle.top,
              width: dropdownStyle.width,
            }}
          >
            {showResults ? (
              <>
                {results.map((item, index) => (
                  <button
                    key={`${item.type}-${item.label}-${index}`}
                    onClick={() => void selectItem(item)}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                      index === activeIdx ? "bg-white/10" : "hover:bg-white/5"
                    }`}
                  >
                    <SearchResultThumb item={item} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-white/80">
                        {item.label}
                      </p>
                      {item.sublabel ? (
                        <p className="truncate text-[11px] text-white/40">
                          {item.sublabel}
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-[10px] capitalize text-white/20">
                      {t(`search.resultType.${item.type}`)}
                    </span>
                  </button>
                ))}
                {showSearchError ? (
                  <div className="px-4 py-5 text-center">
                    <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-amber-300/15 bg-amber-300/8 text-amber-100">
                      <Search size={CRATE_ICON_SIZE.md} />
                    </div>
                    <p className="mt-3 text-sm font-semibold text-white/86">
                      {t("search.unavailableTitle")}
                    </p>
                    <p className="mt-1 text-xs text-white/45">{searchError}</p>
                  </div>
                ) : null}
                {showEmptyResults ? (
                  <div className="px-4 py-5 text-center">
                    <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-cyan-300/15 bg-cyan-300/8 text-cyan-200">
                      <Search size={CRATE_ICON_SIZE.md} />
                    </div>
                    <p className="mt-3 text-sm font-semibold text-white/86">
                      {t("search.noMusicTitle")}
                    </p>
                    <p className="mt-1 text-xs text-white/45">
                      {t("search.noMusicSubtitle")}
                    </p>
                  </div>
                ) : null}
                {trimmedQuery && !showSearchError && (
                  <button
                    onClick={() => {
                      navigate(`/search?q=${encodeURIComponent(trimmedQuery)}`);
                      setShowDropdown(false);
                      setQuery("");
                      setExpanded(false);
                      setCompletedQuery(null);
                      setSearchError(null);
                    }}
                    className="mt-1 w-full border-t border-white/5 px-3 py-2 text-center text-xs text-primary transition-colors hover:bg-white/5"
                  >
                    {t("search.seeAllResults", { query: trimmedQuery })}
                  </button>
                )}
              </>
            ) : null}

            {showRecents ? (
              <>
                <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/40">
                  {t("search.recent")}
                </p>
                {recents.map((recent, index) => (
                  <button
                    key={`${recent.type ?? "query"}:${recent.label}:${index}`}
                    onClick={() => selectRecent(recent)}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                      index === activeIdx ? "bg-white/10" : "hover:bg-white/5"
                    }`}
                  >
                    <Search
                      size={CRATE_ICON_SIZE.xs}
                      className="shrink-0 text-white/20"
                    />
                    <span className="truncate text-[13px] text-white/60">
                      {recent.label}
                    </span>
                  </button>
                ))}
              </>
            ) : null}
          </AppPopover>,
          document.body,
        )
      : null;

  return (
    <div
      ref={containerRef}
      className={cn(
        "group relative flex-1 shrink-0 overflow-visible md:flex-none md:origin-right",
        "transition-[width,transform] duration-500 ease-[cubic-bezier(0.22,1.18,0.36,1)] motion-reduce:transition-none",
        searchOpen
          ? "w-[min(22rem,calc(100vw-8.75rem))] sm:w-[min(24rem,calc(100vw-9.25rem))] md:w-[440px] lg:w-[500px]"
          : "w-[7.25rem] sm:w-[8rem] md:w-11",
      )}
      onMouseEnter={() => {
        if (canHover) openSearch(false);
      }}
      onMouseLeave={() => {
        if (canHover) scheduleCollapseIfIdle();
      }}
    >
      <div
        data-state={searchOpen ? "open" : "closed"}
        className={cn(
          "relative overflow-visible rounded-xl transition-[background-color,border-color,box-shadow,transform] duration-500 ease-[cubic-bezier(0.22,1.18,0.36,1)] motion-reduce:transition-none",
          isDesktop
            ? cn(
                "focus-within:border focus-within:border-cyan-400/25 focus-within:bg-app-surface/78 focus-within:shadow-[0_0_0_1px_rgba(34,211,238,0.08),0_18px_42px_rgba(0,0,0,0.22)]",
                searchOpen
                  ? "border border-white/8 bg-app-surface/68 shadow-[0_18px_42px_rgba(0,0,0,0.22)]"
                  : "border border-cyan-200/16 bg-black/28 shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_14px_34px_rgba(0,0,0,0.24)] backdrop-blur-md md:border-0 md:bg-transparent md:shadow-none md:backdrop-blur-0",
              )
            : "listen-glass-panel listen-search-glass",
          searchOpen ? "md:scale-x-[1.01]" : "md:scale-x-100",
        )}
      >
        <div className="relative flex items-center overflow-hidden rounded-xl">
          <button
            type="button"
            aria-label={t("search.label")}
            aria-expanded={searchOpen}
            data-state={searchOpen ? "open" : "closed"}
            onFocus={() => openSearch(true)}
            onClick={() => {
              openSearch(true);
              focusInputSoon();
            }}
            className={cn(
              "absolute left-0 top-0 z-10 flex h-12 touch-manipulation items-center rounded-xl transition-[color,transform,opacity,width,padding] duration-500 ease-[cubic-bezier(0.22,1.18,0.36,1)] motion-reduce:transition-none md:h-11 md:w-11 md:justify-center md:px-0",
              searchOpen
                ? "w-12 justify-center px-0 text-white/42"
                : "w-full justify-start gap-2 px-4 text-white/72 group-hover:scale-[1.03] group-hover:text-white/88",
            )}
          >
            <Search size={CRATE_ICON_SIZE.md} />
            <span
              className={cn(
                "text-sm font-semibold tracking-[-0.01em] transition-[opacity,transform] duration-300 md:hidden",
                searchOpen
                  ? "pointer-events-none -translate-x-1 opacity-0"
                  : "translate-x-0 opacity-100",
              )}
            >
              {t("search.label")}
            </span>
          </button>
          {loading && searchOpen ? (
            <Loader2
              size={CRATE_ICON_SIZE.sm}
              className="absolute right-4 animate-spin text-white/40"
            />
          ) : null}
          {!loading && query && searchOpen ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setResults([]);
                setCompletedQuery(null);
                setSearchError(null);
                setShowDropdown(true);
                focusInputSoon();
              }}
              className="absolute right-3 z-20 flex size-9 touch-manipulation items-center justify-center text-white/30 hover:text-white/65"
              aria-label={t("search.clear")}
            >
              <X size={CRATE_ICON_SIZE.lg} />
            </button>
          ) : null}
          <input
            ref={inputRef}
            type="text"
            value={query}
            tabIndex={searchOpen ? 0 : -1}
            aria-hidden={!searchOpen}
            onChange={(e) => {
              openSearch(true);
              setQuery(e.target.value);
            }}
            onFocus={() => {
              openSearch(true);
            }}
            onBlur={() => {
              scheduleCollapseIfIdle();
            }}
            onKeyDown={handleKeyDown}
            placeholder={t("search.placeholder")}
            className={cn(
              "h-12 w-full rounded-xl border-0 bg-transparent pl-12 text-[16px] text-white outline-none md:h-11 md:pl-11 md:text-[15px]",
              "transition-[opacity,transform,box-shadow,padding] duration-500 ease-[cubic-bezier(0.22,1.18,0.36,1)] motion-reduce:transition-none",
              "placeholder:text-white/40",
              searchOpen
                ? "pointer-events-auto translate-x-0 scale-100 pr-11 opacity-100"
                : "pointer-events-none translate-x-3 scale-[0.985] pr-4 opacity-0",
            )}
          />
        </div>
      </div>
      {dropdown}
    </div>
  );
}
