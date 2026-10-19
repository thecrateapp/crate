import { useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CRATE_ICON_SIZE, Search, Server } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { EmptyState } from "@crate/ui/domain/lists/EmptyState";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Button } from "@crate/ui/shadcn/button";
import { AppPopover } from "@crate/ui/primitives/AppPopover";

interface SearchDisplayItem {
  type: string;
  label: string;
  sublabel?: string;
  origin?: string;
  nodeName?: string;
  navigateTo?: string;
}
interface SearchDisplayRecent {
  type?: string;
  label: string;
  navigateTo?: string;
  origin?: string;
}
export interface TopBarSearchDropdownViewProps<
  Item extends SearchDisplayItem,
  Recent extends SearchDisplayRecent,
> {
  listboxId: string;
  loading: boolean;
  dropdownRef: { current: HTMLDivElement | null };
  dropdownStyle: {
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  };
  visibility: {
    showResults: boolean;
    showRecents: boolean;
    showSearchError: boolean;
    showEmptyResults: boolean;
  };
  results: Item[];
  recents: Recent[];
  activeIdx: number;
  trimmedQuery: string;
  searchError: string | null;
  onSelectItem: (item: Item) => Promise<void>;
  onSelectRecent: (recent: Recent) => void;
  onSeeAllResults: () => void;
  t: (key: string, options?: { query: string }) => string;
  renderThumb: (item: Item) => ReactNode;
}

/** Pure presentation; the app injects transport-aware artwork and translations. */
export function TopBarSearchDropdownView<
  Item extends SearchDisplayItem,
  Recent extends SearchDisplayRecent,
>({
  listboxId,
  loading,
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
  t,
  renderThumb,
}: TopBarSearchDropdownViewProps<Item, Recent>) {
  const { showResults, showRecents, showSearchError, showEmptyResults } =
    visibility;

  useLayoutEffect(() => {
    const panel = dropdownRef.current;
    const option = panel?.ownerDocument.getElementById(
      `${listboxId}-${activeIdx}`,
    );
    if (option && panel?.contains(option))
      option.scrollIntoView({ block: "nearest" });
  }, [activeIdx, dropdownRef, listboxId]);

  return createPortal(
    <AppPopover
      ref={dropdownRef}
      className="fixed overflow-y-auto py-1"
      style={dropdownStyle}
    >
      {loading ? (
        <LoadingState label={t("common.loading")} className="p-3" />
      ) : null}
      {showRecents ? (
        <MonoLabel className="px-3 py-2">{t("search.recent")}</MonoLabel>
      ) : null}
      <div id={listboxId} role="listbox" aria-label={t("search.label")}>
        {showResults ? (
          <>
            {results.map((item, index) => (
              <button
                key={[
                  item.type,
                  item.navigateTo ?? item.label,
                  item.sublabel ?? "",
                  item.origin ?? "local",
                ].join(":")}
                type="button"
                role="option"
                tabIndex={-1}
                id={`${listboxId}-${index}`}
                aria-selected={index === activeIdx}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => void onSelectItem(item)}
                className={cn(
                  "flex w-full items-center gap-3 border-l-2 px-3 py-2 text-left transition-colors hover:text-accent-action-hi",
                  index === activeIdx
                    ? "border-accent-action-hi text-accent-action-hi"
                    : "border-transparent text-text-primary",
                )}
              >
                {renderThumb(item)}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-caption text-text-primary/80">
                    {item.label}
                  </p>
                  {item.sublabel ? (
                    <p className="truncate text-xs text-text-primary/40">
                      {item.sublabel}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5 text-xs">
                  {item.origin === "remote" ? (
                    <InfoBadge icon={Server}>
                      {item.nodeName || t("search.remoteSource")}
                    </InfoBadge>
                  ) : null}
                  <span className="capitalize text-text-primary/20">
                    {t("search.resultType." + item.type)}
                  </span>
                </div>
              </button>
            ))}
          </>
        ) : null}
        {showRecents ? (
          <>
            {recents.map((recent, index) => (
              <button
                key={[
                  recent.type ?? "query",
                  recent.navigateTo ?? recent.label,
                  recent.origin ?? "local",
                ].join(":")}
                type="button"
                role="option"
                tabIndex={-1}
                id={`${listboxId}-${index}`}
                aria-selected={index === activeIdx}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => onSelectRecent(recent)}
                className={cn(
                  "flex w-full items-center gap-3 border-l-2 px-3 py-2 text-left transition-colors hover:text-accent-action-hi",
                  index === activeIdx
                    ? "border-accent-action-hi text-accent-action-hi"
                    : "border-transparent text-text-primary",
                )}
              >
                <Search
                  size={CRATE_ICON_SIZE.xs}
                  className="shrink-0 text-text-primary/20"
                />
                <span className="truncate text-caption text-text-primary/60">
                  {recent.label}
                </span>
              </button>
            ))}
          </>
        ) : null}
      </div>
      {showSearchError ? (
        <div className="p-4">
          <ErrorState
            title={t("search.unavailableTitle")}
            message={searchError}
          />
        </div>
      ) : null}
      {showEmptyResults ? (
        <div className="p-4">
          <EmptyState
            title={t("search.noMusicTitle")}
            description={t("search.noMusicSubtitle")}
          />
        </div>
      ) : null}
      {trimmedQuery && !showSearchError ? (
        <Button variant="ghost" className="w-full" onClick={onSeeAllResults}>
          {t("search.seeAllResults", { query: trimmedQuery })}
        </Button>
      ) : null}
    </AppPopover>,
    document.body,
  );
}
