import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { SetStateAction } from "react";

import type { TopBarSearchItem } from "./topbar-search-model";
import { focusWithModality } from "@crate/ui/lib/input-modality";

export function useTopBarSearchLifecycle({
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const collapseTimerRef = useRef<number | undefined>(undefined);
  const showDropdownRef = useRef(showDropdown);
  const [dropdownStyle, setDropdownStyle] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
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

  const collapseOnFocusExit = useCallback(
    (nextFocus: EventTarget | null) => {
      const leftSearch =
        nextFocus instanceof Node &&
        !containerRef.current?.contains(nextFocus) &&
        !dropdownRef.current?.contains(nextFocus);
      if (leftSearch && !queryRef.current.trim()) {
        setShowDropdown(false);
        scheduleCollapseIfIdle(false);
        return;
      }
      scheduleCollapseIfIdle();
    },
    [queryRef, scheduleCollapseIfIdle, setShowDropdown],
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
    const width = Math.min(rect.width || 384, window.innerWidth - 16);
    const next = {
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: rect.bottom + 4,
      width,
      maxHeight: Math.max(0, window.innerHeight - rect.bottom - 12),
    };
    setDropdownStyle((previous) =>
      previous &&
      Object.keys(next).every(
        (key) =>
          previous[key as keyof typeof next] === next[key as keyof typeof next],
      )
        ? previous
        : next,
    );
  }, []);

  useLayoutEffect(() => {
    if (!showDropdown) {
      setDropdownStyle(null);
      return;
    }

    updateDropdownPosition();
    const handlePositionUpdate = () => updateDropdownPosition();
    const observer = new ResizeObserver(handlePositionUpdate);
    if (containerRef.current) observer.observe(containerRef.current);
    window.addEventListener("resize", handlePositionUpdate);
    window.addEventListener("scroll", handlePositionUpdate, true);
    return () => {
      observer.disconnect();
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
    requestAnimationFrame(() => focusWithModality(triggerRef.current));
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
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing)
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeSearchEvent();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchOpen]);

  return {
    closeSearch,
    collapseOnFocusExit,
    containerRef,
    dropdownRef,
    dropdownStyle,
    focusInputSoon,
    inputRef,
    triggerRef,
    openSearch,
    scheduleCollapseIfIdle,
  };
}
