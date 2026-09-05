import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import type { SetStateAction } from "react";
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
import { CrateImage } from "@/components/artwork/CrateImage";
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
      <CrateImage
        src={item.imageUrl}
        alt=""
        className={`h-8 w-8 shrink-0 bg-text-primary/5 object-cover ${
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
        className="h-8 w-8 shrink-0 rounded-full bg-text-primary/5 p-1.5 text-text-primary/30"
      />
    );
  }
  if (item.type === "album") {
    return (
      <Disc
        size={CRATE_ICON_SIZE.md}
        className="h-8 w-8 shrink-0 rounded bg-text-primary/5 p-1.5 text-text-primary/30"
      />
    );
  }
  return (
    <Music
      size={CRATE_ICON_SIZE.md}
      className="h-8 w-8 shrink-0 rounded bg-text-primary/5 p-1.5 text-text-primary/30"
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

type TopBarSearchState = {
  query: string;
  results: TopBarSearchItem[];
  loading: boolean;
  completedQuery: string | null;
  searchError: string | null;
  showDropdown: boolean;
  activeIdx: number;
  recents: TopBarSearchRecentEntry[];
  expanded: boolean;
};

type TopBarSearchAction =
  | { type: "set-query"; value: string }
  | { type: "set-results"; value: TopBarSearchItem[] }
  | { type: "set-loading"; value: boolean }
  | { type: "set-completed-query"; value: string | null }
  | { type: "set-search-error"; value: string | null }
  | { type: "set-show-dropdown"; value: boolean }
  | { type: "set-active-index"; value: SetStateAction<number> }
  | { type: "set-recents"; value: TopBarSearchRecentEntry[] }
  | { type: "set-expanded"; value: boolean };

const initialTopBarSearchState: TopBarSearchState = {
  query: "",
  results: [],
  loading: false,
  completedQuery: null,
  searchError: null,
  showDropdown: false,
  activeIdx: -1,
  recents: [],
  expanded: false,
};

function topBarSearchReducer(
  state: TopBarSearchState,
  action: TopBarSearchAction,
): TopBarSearchState {
  switch (action.type) {
    case "set-query":
      return { ...state, query: action.value };
    case "set-results":
      return { ...state, results: action.value };
    case "set-loading":
      return { ...state, loading: action.value };
    case "set-completed-query":
      return { ...state, completedQuery: action.value };
    case "set-search-error":
      return { ...state, searchError: action.value };
    case "set-show-dropdown":
      return { ...state, showDropdown: action.value };
    case "set-active-index":
      return {
        ...state,
        activeIdx:
          typeof action.value === "function"
            ? action.value(state.activeIdx)
            : action.value,
      };
    case "set-recents":
      return { ...state, recents: action.value };
    case "set-expanded":
      return { ...state, expanded: action.value };
  }
}

function useTopBarSearchState() {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(
    topBarSearchReducer,
    initialTopBarSearchState,
    (initialState) => ({
      ...initialState,
      recents: getTopBarSearchRecents(),
    }),
  );
  const queryRef = useRef(state.query);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    queryRef.current = state.query;
  }, [state.query]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const requestQuery = state.query.trim();
    if (!requestQuery) {
      dispatch({ type: "set-results", value: [] });
      dispatch({ type: "set-loading", value: false });
      dispatch({ type: "set-completed-query", value: null });
      dispatch({ type: "set-search-error", value: null });
      return;
    }

    dispatch({ type: "set-loading", value: true });
    dispatch({ type: "set-completed-query", value: null });
    dispatch({ type: "set-search-error", value: null });
    debounceRef.current = setTimeout(() => {
      api<SearchResult>(
        `/api/catalog/search?q=${encodeURIComponent(requestQuery)}&limit=10`,
      )
        .then((data) => {
          if (queryRef.current.trim() !== requestQuery) return;
          dispatch({
            type: "set-results",
            value: flattenTopBarSearchResults(data),
          });
          dispatch({ type: "set-active-index", value: -1 });
          dispatch({ type: "set-completed-query", value: requestQuery });
          dispatch({ type: "set-search-error", value: null });
        })
        .catch((error) => {
          if (queryRef.current.trim() !== requestQuery) return;
          dispatch({ type: "set-results", value: [] });
          dispatch({ type: "set-active-index", value: -1 });
          dispatch({ type: "set-completed-query", value: requestQuery });
          dispatch({
            type: "set-search-error",
            value: searchErrorHint(error, {
              session: t("search.errors.sessionRefresh"),
              generic: t("search.errors.tryAgain"),
            }),
          });
        })
        .finally(() => {
          if (queryRef.current.trim() === requestQuery) {
            dispatch({ type: "set-loading", value: false });
          }
        });
    }, 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [state.query, t]);

  const setQuery = useCallback(
    (value: string) => dispatch({ type: "set-query", value }),
    [],
  );
  const setResults = useCallback(
    (value: TopBarSearchItem[]) => dispatch({ type: "set-results", value }),
    [],
  );
  const setLoading = useCallback(
    (value: boolean) => dispatch({ type: "set-loading", value }),
    [],
  );
  const setCompletedQuery = useCallback(
    (value: string | null) => dispatch({ type: "set-completed-query", value }),
    [],
  );
  const setSearchError = useCallback(
    (value: string | null) => dispatch({ type: "set-search-error", value }),
    [],
  );
  const setShowDropdown = useCallback(
    (value: boolean) => dispatch({ type: "set-show-dropdown", value }),
    [],
  );
  const setActiveIdx = useCallback(
    (value: SetStateAction<number>) =>
      dispatch({ type: "set-active-index", value }),
    [],
  );
  const setRecents = useCallback(
    (value: TopBarSearchRecentEntry[]) =>
      dispatch({ type: "set-recents", value }),
    [],
  );
  const setExpanded = useCallback(
    (value: boolean) => dispatch({ type: "set-expanded", value }),
    [],
  );

  return {
    ...state,
    queryRef,
    setQuery,
    setResults,
    setLoading,
    setCompletedQuery,
    setSearchError,
    setShowDropdown,
    setActiveIdx,
    setRecents,
    setExpanded,
  };
}

function useTopBarSearchSelection({
  query,
  results,
  recents,
  activeIdx,
  navigate,
  play,
  t,
  focusInputSoon,
  setQuery,
  setResults,
  setCompletedQuery,
  setSearchError,
  setShowDropdown,
  setActiveIdx,
  setRecents,
  setExpanded,
  closeSearch,
}: {
  query: string;
  results: TopBarSearchItem[];
  recents: TopBarSearchRecentEntry[];
  activeIdx: number;
  navigate: (to: string) => void;
  play: ReturnType<typeof usePlayerActions>["play"];
  t: ReturnType<typeof useTranslation>["t"];
  focusInputSoon: () => void;
  setQuery: (value: string) => void;
  setResults: (value: TopBarSearchItem[]) => void;
  setCompletedQuery: (value: string | null) => void;
  setSearchError: (value: string | null) => void;
  setShowDropdown: (value: boolean) => void;
  setActiveIdx: (value: SetStateAction<number>) => void;
  setRecents: (value: TopBarSearchRecentEntry[]) => void;
  setExpanded: (value: boolean) => void;
  closeSearch: () => void;
}) {
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
    [
      navigate,
      play,
      setCompletedQuery,
      setExpanded,
      setQuery,
      setRecents,
      setSearchError,
      setShowDropdown,
      t,
    ],
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
    [
      focusInputSoon,
      navigate,
      setCompletedQuery,
      setExpanded,
      setQuery,
      setRecents,
      setResults,
      setSearchError,
      setShowDropdown,
    ],
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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

  return { handleKeyDown, selectItem, selectRecent };
}

function useTopBarSearchLifecycle({
  searchOpen,
  showDropdown,
  queryRef,
  setQuery,
  setResults,
  setCompletedQuery,
  setSearchError,
  setShowDropdown,
  setActiveIdx,
  setExpanded,
}: {
  searchOpen: boolean;
  showDropdown: boolean;
  queryRef: { current: string };
  setQuery: (value: string) => void;
  setResults: (value: TopBarSearchItem[]) => void;
  setCompletedQuery: (value: string | null) => void;
  setSearchError: (value: string | null) => void;
  setShowDropdown: (value: boolean) => void;
  setActiveIdx: (value: SetStateAction<number>) => void;
  setExpanded: (value: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const collapseTimerRef = useRef<number | undefined>(undefined);
  const showDropdownRef = useRef(showDropdown);
  const [dropdownStyle, setDropdownStyle] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);

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

  const collapseIfIdle = useCallback(
    (nextShowDropdown?: boolean) => {
      if (queryRef.current.trim()) return;
      if ((nextShowDropdown ?? showDropdownRef.current) === true) return;
      if (containerRef.current?.contains(document.activeElement)) return;
      setExpanded(false);
      setActiveIdx(-1);
    },
    [containerRef, queryRef, setActiveIdx, setExpanded, showDropdownRef],
  );

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
      if (withDropdown) setShowDropdown(true);
    },
    [clearCollapseTimer, setExpanded, setShowDropdown],
  );

  useEffect(() => clearCollapseTimer, [clearCollapseTimer]);

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
    const handlePositionUpdate = () => updateDropdownPosition();
    window.addEventListener("resize", handlePositionUpdate);
    window.addEventListener("scroll", handlePositionUpdate, true);
    return () => {
      window.removeEventListener("resize", handlePositionUpdate);
      window.removeEventListener("scroll", handlePositionUpdate, true);
    };
  }, [showDropdown, updateDropdownPosition]);

  const closeSearch = useCallback(() => {
    setShowDropdown(false);
    setQuery("");
    setResults([]);
    setCompletedQuery(null);
    setSearchError(null);
    setExpanded(false);
    setActiveIdx(-1);
    inputRef.current?.blur();
  }, [
    setActiveIdx,
    setCompletedQuery,
    setExpanded,
    setQuery,
    setResults,
    setSearchError,
    setShowDropdown,
  ]);
  const closeSearchEvent = useEffectEvent(closeSearch);

  useEffect(() => {
    if (!searchOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeSearchEvent();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchOpen]);

  return {
    closeSearch,
    containerRef,
    dropdownRef,
    dropdownStyle,
    focusInputSoon,
    inputRef,
    openSearch,
    scheduleCollapseIfIdle,
  };
}

type TopBarSearchInputProps = {
  state: {
    query: string;
    results: TopBarSearchItem[];
    loading: boolean;
    completedQuery: string | null;
    searchError: string | null;
    showDropdown: boolean;
    activeIdx: number;
    recents: TopBarSearchRecentEntry[];
    searchOpen: boolean;
  };
  environment: { canHover: boolean; isDesktop: boolean };
  refs: {
    containerRef: { current: HTMLDivElement | null };
    dropdownRef: { current: HTMLDivElement | null };
    inputRef: { current: HTMLInputElement | null };
    dropdownStyle: { left: number; top: number; width: number } | null;
  };
  actions: {
    openSearch: (withDropdown?: boolean) => void;
    focusInputSoon: () => void;
    scheduleCollapseIfIdle: (nextShowDropdown?: boolean) => void;
    setQuery: (value: string) => void;
    setResults: (value: TopBarSearchItem[]) => void;
    setCompletedQuery: (value: string | null) => void;
    setSearchError: (value: string | null) => void;
    setShowDropdown: (value: boolean) => void;
    setExpanded: (value: boolean) => void;
  };
  handlers: {
    handleKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
    selectItem: (item: TopBarSearchItem) => Promise<void>;
    selectRecent: (recent: TopBarSearchRecentEntry) => void;
  };
  navigate: (to: string) => void;
  t: ReturnType<typeof useTranslation>["t"];
};

type TopBarSearchVisibility = {
  showResults: boolean;
  showRecents: boolean;
  showSearchError: boolean;
  showEmptyResults: boolean;
};

function getTopBarSearchVisibility({
  showDropdown,
  trimmedQuery,
  loading,
  completedQuery,
  searchError,
  results,
  recents,
}: {
  showDropdown: boolean;
  trimmedQuery: string;
  loading: boolean;
  completedQuery: string | null;
  searchError: string | null;
  results: TopBarSearchItem[];
  recents: TopBarSearchRecentEntry[];
}): TopBarSearchVisibility {
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

  return {
    showRecents: showDropdown && !trimmedQuery && recents.length > 0,
    showSearchError,
    showEmptyResults,
    showResults:
      showDropdown &&
      trimmedQuery.length > 0 &&
      (results.length > 0 || loading || showEmptyResults || showSearchError),
  };
}

function TopBarSearchInput({
  state,
  environment,
  refs,
  actions,
  handlers,
  navigate,
  t,
}: TopBarSearchInputProps) {
  const {
    query,
    results,
    loading,
    completedQuery,
    searchError,
    showDropdown,
    recents,
  } = state;
  const trimmedQuery = query.trim();
  const visibility = getTopBarSearchVisibility({
    showDropdown,
    trimmedQuery,
    loading,
    completedQuery,
    searchError,
    results,
    recents,
  });

  return (
    <TopBarSearchContainer
      state={state}
      environment={environment}
      refs={refs}
      actions={actions}
      handlers={handlers}
      visibility={visibility}
      trimmedQuery={trimmedQuery}
      navigate={navigate}
      t={t}
    />
  );
}

type TopBarSearchLayoutProps = TopBarSearchInputProps & {
  visibility: TopBarSearchVisibility;
  trimmedQuery: string;
};

function TopBarSearchContainer({
  state,
  environment,
  refs,
  actions,
  handlers,
  visibility,
  trimmedQuery,
  navigate,
  t,
}: TopBarSearchLayoutProps) {
  const { results, searchError, activeIdx, recents, searchOpen } = state;
  const { canHover } = environment;
  const { containerRef, dropdownRef, inputRef, dropdownStyle } = refs;
  const {
    openSearch,
    scheduleCollapseIfIdle,
    setQuery,
    setCompletedQuery,
    setSearchError,
    setShowDropdown,
    setExpanded,
  } = actions;
  const { handleKeyDown, selectItem, selectRecent } = handlers;

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
      <TopBarSearchControls
        state={state}
        environment={environment}
        inputRef={inputRef}
        actions={actions}
        t={t}
        handlers={{ handleKeyDown }}
      />
      {dropdownStyle && (visibility.showResults || visibility.showRecents) ? (
        <TopBarSearchDropdown
          dropdownRef={dropdownRef}
          dropdownStyle={dropdownStyle}
          visibility={visibility}
          results={results}
          recents={recents}
          activeIdx={activeIdx}
          trimmedQuery={trimmedQuery}
          searchError={searchError}
          onSelectItem={selectItem}
          onSelectRecent={selectRecent}
          onSeeAllResults={() => {
            navigate(`/search?q=${encodeURIComponent(trimmedQuery)}`);
            setShowDropdown(false);
            setQuery("");
            setExpanded(false);
            setCompletedQuery(null);
            setSearchError(null);
          }}
        />
      ) : null}
    </div>
  );
}

function TopBarSearchControls({
  state,
  environment,
  inputRef,
  actions,
  t,
  handlers,
}: {
  state: TopBarSearchInputProps["state"];
  environment: TopBarSearchInputProps["environment"];
  inputRef: TopBarSearchInputProps["refs"]["inputRef"];
  actions: TopBarSearchInputProps["actions"];
  t: TopBarSearchInputProps["t"];
  handlers: Pick<TopBarSearchInputProps["handlers"], "handleKeyDown">;
}) {
  const { query, loading, searchOpen } = state;
  const { isDesktop } = environment;
  const {
    openSearch,
    focusInputSoon,
    scheduleCollapseIfIdle,
    setQuery,
    setResults,
    setCompletedQuery,
    setSearchError,
    setShowDropdown,
  } = actions;

  return (
    <div
      data-state={searchOpen ? "open" : "closed"}
      className={cn(
        "relative overflow-visible rounded-xl transition-[background-color,border-color,box-shadow,transform] duration-500 ease-[cubic-bezier(0.22,1.18,0.36,1)] motion-reduce:transition-none",
        isDesktop
          ? searchOpen
            ? "border border-text-primary/8 bg-surface-canvas/68 shadow-glass-hover"
            : "border-0 bg-transparent shadow-none backdrop-blur-0"
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
            "absolute left-0 top-0 z-10 flex h-12 touch-manipulation items-center rounded-xl border-0 bg-transparent shadow-none backdrop-blur-0 transition-[color,transform,opacity,width,padding] duration-500 ease-[cubic-bezier(0.22,1.18,0.36,1)] motion-reduce:transition-none md:h-11 md:w-11 md:justify-center md:px-0",
            searchOpen
              ? "w-12 justify-center px-0 text-text-primary/42"
              : "w-full justify-start gap-2 px-4 text-text-primary/72 group-hover:scale-[1.03] group-hover:text-text-primary/88",
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
            className="absolute right-4 animate-spin text-text-primary/40"
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
            className="absolute right-3 z-20 flex size-9 touch-manipulation items-center justify-center text-text-primary/30 hover:text-text-primary/65"
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
          onKeyDown={handlers.handleKeyDown}
          placeholder={t("search.placeholder")}
          className={cn(
            "h-12 w-full rounded-xl border-0 bg-transparent pl-12 text-[16px] text-text-primary outline-none md:h-11 md:pl-11 md:text-[15px]",
            "transition-[opacity,transform,box-shadow,padding] duration-500 ease-[cubic-bezier(0.22,1.18,0.36,1)] motion-reduce:transition-none",
            "placeholder:text-text-primary/40",
            searchOpen
              ? "pointer-events-auto translate-x-0 scale-100 pr-11 opacity-100"
              : "pointer-events-none translate-x-3 scale-[0.985] pr-4 opacity-0",
          )}
        />
      </div>
    </div>
  );
}

export function TopBarSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { play } = usePlayerActions();
  const canHover = useHoverCapability();
  const isDesktop = useIsDesktop();
  const {
    query,
    results,
    loading,
    completedQuery,
    searchError,
    showDropdown,
    activeIdx,
    recents,
    expanded,
    queryRef,
    setQuery,
    setResults,
    setCompletedQuery,
    setSearchError,
    setShowDropdown,
    setActiveIdx,
    setRecents,
    setExpanded,
  } = useTopBarSearchState();

  const queryActive = query.trim().length > 0;
  const searchOpen = expanded || showDropdown || queryActive;

  useEffect(() => {
    if (query.trim()) {
      setExpanded(true);
      setShowDropdown(true);
    }
  }, [query, setExpanded, setShowDropdown]);

  const lifecycle = useTopBarSearchLifecycle({
    searchOpen,
    showDropdown,
    queryRef,
    setQuery,
    setResults,
    setCompletedQuery,
    setSearchError,
    setShowDropdown,
    setActiveIdx,
    setExpanded,
  });

  useDismissibleLayer({
    active: showDropdown,
    refs: [lifecycle.containerRef, lifecycle.dropdownRef, lifecycle.inputRef],
    onDismiss: () => {
      setShowDropdown(false);
      lifecycle.scheduleCollapseIfIdle(false);
    },
    closeOnEscape: false,
  });

  const handlers = useTopBarSearchSelection({
    query,
    results,
    recents,
    activeIdx,
    navigate,
    play,
    t,
    focusInputSoon: lifecycle.focusInputSoon,
    setQuery,
    setResults,
    setCompletedQuery,
    setSearchError,
    setShowDropdown,
    setActiveIdx,
    setRecents,
    setExpanded,
    closeSearch: lifecycle.closeSearch,
  });

  return (
    <TopBarSearchInput
      state={{
        query,
        results,
        loading,
        completedQuery,
        searchError,
        showDropdown,
        activeIdx,
        recents,
        searchOpen,
      }}
      environment={{ canHover, isDesktop }}
      refs={{
        containerRef: lifecycle.containerRef,
        dropdownRef: lifecycle.dropdownRef,
        inputRef: lifecycle.inputRef,
        dropdownStyle: lifecycle.dropdownStyle,
      }}
      actions={{
        openSearch: lifecycle.openSearch,
        focusInputSoon: lifecycle.focusInputSoon,
        scheduleCollapseIfIdle: lifecycle.scheduleCollapseIfIdle,
        setQuery,
        setResults,
        setCompletedQuery,
        setSearchError,
        setShowDropdown,
        setExpanded,
      }}
      handlers={handlers}
      navigate={navigate}
      t={t}
    />
  );
}

function TopBarSearchDropdown({
  dropdownRef,
  dropdownStyle,
  visibility,
  results,
  recents,
  activeIdx,
  trimmedQuery,
  searchError,
  onSelectItem,
  onSelectRecent,
  onSeeAllResults,
}: {
  dropdownRef: { current: HTMLDivElement | null };
  dropdownStyle: { left: number; top: number; width: number };
  visibility: {
    showResults: boolean;
    showRecents: boolean;
    showSearchError: boolean;
    showEmptyResults: boolean;
  };
  results: TopBarSearchItem[];
  recents: TopBarSearchRecentEntry[];
  activeIdx: number;
  trimmedQuery: string;
  searchError: string | null;
  onSelectItem: (item: TopBarSearchItem) => Promise<void>;
  onSelectRecent: (recent: TopBarSearchRecentEntry) => void;
  onSeeAllResults: () => void;
}) {
  const { t } = useTranslation();
  const { showResults, showRecents, showSearchError, showEmptyResults } =
    visibility;

  return createPortal(
    <AppPopover
      ref={dropdownRef}
      className={cn(
        "listen-glass-panel fixed max-h-80 overflow-y-auto rounded-[12px] py-1",
        showRecents ? "max-h-none" : undefined,
      )}
      style={dropdownStyle}
    >
      {showResults ? (
        <>
          {results.map((item, index) => (
            <button
              key={`${item.type}-${item.label}-${index}`}
              onClick={() => void onSelectItem(item)}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                index === activeIdx
                  ? "bg-text-primary/10"
                  : "hover:bg-text-primary/5"
              }`}
            >
              <SearchResultThumb item={item} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-text-primary/80">
                  {item.label}
                </p>
                {item.sublabel ? (
                  <p className="truncate text-[11px] text-text-primary/40">
                    {item.sublabel}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1.5 text-[10px]">
                {item.origin === "remote" ? (
                  <span className="rounded-full border border-accent-action/15 bg-accent-action/8 px-1.5 py-0.5 text-accent-action/80">
                    {item.nodeName || t("search.remoteSource")}
                  </span>
                ) : null}
                <span className="capitalize text-text-primary/20">
                  {t(`search.resultType.${item.type}`)}
                </span>
              </div>
            </button>
          ))}
          {showSearchError ? (
            <SearchMessage
              iconClassName="border-state-warning/15 bg-state-warning/8 text-state-warning"
              title={t("search.unavailableTitle")}
              message={searchError}
            />
          ) : null}
          {showEmptyResults ? (
            <SearchMessage
              iconClassName="border-accent-action/15 bg-accent-action/8 text-accent-action"
              title={t("search.noMusicTitle")}
              message={t("search.noMusicSubtitle")}
            />
          ) : null}
          {trimmedQuery && !showSearchError ? (
            <button
              onClick={onSeeAllResults}
              className="mt-1 w-full border-t border-text-primary/5 px-3 py-2 text-center text-xs text-accent-action transition-colors hover:bg-text-primary/5"
            >
              {t("search.seeAllResults", { query: trimmedQuery })}
            </button>
          ) : null}
        </>
      ) : null}
      {showRecents ? (
        <>
          <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-text-primary/40">
            {t("search.recent")}
          </p>
          {recents.map((recent, index) => (
            <button
              key={`${recent.type ?? "query"}:${recent.label}:${index}`}
              onClick={() => onSelectRecent(recent)}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                index === activeIdx
                  ? "bg-text-primary/10"
                  : "hover:bg-text-primary/5"
              }`}
            >
              <Search
                size={CRATE_ICON_SIZE.xs}
                className="shrink-0 text-text-primary/20"
              />
              <span className="truncate text-[13px] text-text-primary/60">
                {recent.label}
              </span>
            </button>
          ))}
        </>
      ) : null}
    </AppPopover>,
    document.body,
  );
}

function SearchMessage({
  iconClassName,
  title,
  message,
}: {
  iconClassName: string;
  title: string;
  message: string | null;
}) {
  return (
    <div className="px-4 py-5 text-center">
      <div
        className={cn(
          "mx-auto flex h-10 w-10 items-center justify-center rounded-full border",
          iconClassName,
        )}
      >
        <Search size={CRATE_ICON_SIZE.md} />
      </div>
      <p className="mt-3 text-sm font-semibold text-text-primary/86">{title}</p>
      <p className="mt-1 text-xs text-text-primary/45">{message}</p>
    </div>
  );
}
