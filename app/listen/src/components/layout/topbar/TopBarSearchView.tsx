import { useId } from "react";
import { CRATE_ICON_SIZE, Search } from "@crate/ui/icons";
import { Button } from "@crate/ui/shadcn/button";
import { SearchInput } from "@crate/ui/primitives/SearchInput";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import {
  type TopBarSearchItem,
  type TopBarSearchRecentEntry,
} from "./topbar-search-model";
import { TopBarSearchDropdown } from "./TopBarSearchDropdown";

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
    triggerRef: { current: HTMLButtonElement | null };
    dropdownStyle: {
      left: number;
      top: number;
      width: number;
      maxHeight: number;
    } | null;
  };
  actions: {
    openSearch: (withDropdown?: boolean) => void;
    focusInputSoon: () => void;
    scheduleCollapseIfIdle: (nextShowDropdown?: boolean) => void;
    collapseOnFocusExit: (nextFocus: EventTarget | null) => void;
    setQuery: (value: string) => void;
    setComposing: (value: boolean) => void;
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

export function TopBarSearchInput({
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
  const {
    results,
    searchError,
    activeIdx,
    recents,
    searchOpen,
    query,
    loading,
  } = state;
  const { canHover } = environment;
  const { containerRef, dropdownRef, inputRef, triggerRef, dropdownStyle } =
    refs;
  const {
    openSearch,
    focusInputSoon,
    scheduleCollapseIfIdle,
    collapseOnFocusExit,
    setQuery,
    setResults,
    setCompletedQuery,
    setSearchError,
    setShowDropdown,
    setExpanded,
    setComposing,
  } = actions;
  const { handleKeyDown, selectItem, selectRecent } = handlers;
  const listboxId = useId();
  const visible = Boolean(
    dropdownStyle && (visibility.showResults || visibility.showRecents),
  );
  const count = trimmedQuery ? results.length : recents.length;

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
      <div data-state={searchOpen ? "open" : "closed"}>
        <Button
          ref={triggerRef}
          variant="ghost"
          aria-label={t("search.label")}
          aria-expanded={searchOpen}
          hidden={searchOpen}
          onClick={() => {
            openSearch(true);
            focusInputSoon();
          }}
        >
          <Search aria-hidden="true" size={CRATE_ICON_SIZE.md} />
          <span className="md:hidden">{t("search.label")}</span>
        </Button>
        <div hidden={!searchOpen}>
          <SearchInput
            ref={inputRef}
            value={query}
            label={t("search.label")}
            placeholder={t("search.placeholder")}
            clearLabel={t("search.clear")}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={visible}
            aria-controls={visible ? listboxId : undefined}
            aria-busy={loading}
            aria-activedescendant={
              visible && activeIdx >= 0 && activeIdx < count
                ? `${listboxId}-${activeIdx}`
                : undefined
            }
            onValueChange={(next) => {
              openSearch(true);
              setQuery(next);
            }}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onFocus={() => openSearch(true)}
            onBlur={(event) => collapseOnFocusExit(event.relatedTarget)}
            onKeyDown={handleKeyDown}
            onClear={() => {
              setResults([]);
              setCompletedQuery(null);
              setSearchError(null);
              setShowDropdown(true);
            }}
          />
        </div>
      </div>
      {dropdownStyle && (visibility.showResults || visibility.showRecents) ? (
        <TopBarSearchDropdown
          listboxId={listboxId}
          loading={loading}
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
