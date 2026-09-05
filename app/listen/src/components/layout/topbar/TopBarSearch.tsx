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

import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { useHoverCapability } from "@/hooks/use-hover-capability";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
import { api, ApiError } from "@/lib/api";
import { resolveRemotePlayableTrack } from "@/lib/remote-track-playback";
import { TopBarSearchInput } from "./TopBarSearchView";

import {
  addTopBarSearchRecent,
  flattenTopBarSearchResults,
  getTopBarSearchRecents,
  type SearchResult,
  type TopBarSearchRecentEntry,
  type TopBarSearchItem,
} from "./topbar-search-model";

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
