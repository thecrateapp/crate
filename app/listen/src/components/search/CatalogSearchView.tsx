import type { ComponentProps, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EntityRow } from "@crate/ui/domain/entity/EntityRow";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { SectionHeader } from "@crate/ui/domain/lists/SectionHeader";
import { EmptyState, ErrorState, LoadingState } from "@crate/ui/domain/states";
import { FormField } from "@crate/ui/primitives/FormField";
import { SearchInput } from "@crate/ui/primitives/SearchInput";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Disc3, Music2, User } from "@crate/ui/icons";
import type {
  CatalogSearchItem,
  CatalogSearchKind,
} from "./catalog-search-model";
export interface CatalogSearchProps<T> {
  label: string;
  query: string;
  onQueryChange: (value: string) => void;
  items: readonly CatalogSearchItem<T>[];
  kinds?: readonly CatalogSearchKind[];
  searching: boolean;
  error?: string;
  onRetry?: () => void;
  emptyMessage?: string;
  onSelect?: (item: CatalogSearchItem<T>) => void;
  itemLabel?: (item: CatalogSearchItem<T>) => string;
  renderAction?: (item: CatalogSearchItem<T>) => ReactNode;
  renderImage?: ComponentProps<typeof MediaCover>["renderImage"];
}
const allKinds: readonly CatalogSearchKind[] = ["artist", "album", "track"];
const countKeys = {
  artist: "search.artistsCount",
  album: "search.albumsCount",
  track: "search.tracksCount",
} as const;
const icons = { artist: User, album: Disc3, track: Music2 };
/** Controlled domain search. Owning controllers retain debounce, transport and selection authority. */
export function CatalogSearchView<T>({
  label,
  query,
  onQueryChange,
  items,
  kinds = allKinds,
  searching,
  error,
  onRetry,
  emptyMessage,
  onSelect,
  itemLabel,
  renderAction,
  renderImage,
}: CatalogSearchProps<T>) {
  const { t } = useTranslation();
  const groups = [...new Set(kinds)]
    .map((kind) => ({
      kind,
      items: items.filter((item) => item.kind === kind),
    }))
    .filter((group) => group.items.length);
  return (
    <div data-slot="catalog-search" className="space-y-3">
      <FormField label={label}>
        {(control) => (
          <SearchInput
            {...control}
            label={label}
            placeholder={label}
            clearLabel={t("search.clear")}
            value={query}
            onValueChange={onQueryChange}
          />
        )}
      </FormField>
      {query.trim().length >= 2 ? (
        searching && !groups.length ? (
          <LoadingState label={t("search.loadingResults")} />
        ) : error ? (
          <ErrorState
            message={error}
            onRetry={onRetry}
            retryLabel={t("common.retry")}
          />
        ) : groups.length ? (
          <div
            className="max-h-64 space-y-3 overflow-y-auto"
            aria-busy={searching}
          >
            {searching ? (
              <LoadingState label={t("search.loadingResults")} />
            ) : null}
            {groups.map((group) => (
              <section
                key={group.kind}
                data-kind={group.kind}
                className="space-y-2"
              >
                {kinds.length > 1 ? (
                  <SectionHeader
                    as="h3"
                    title={t(countKeys[group.kind], {
                      count: group.items.length,
                    })}
                  />
                ) : null}
                <ul className="divide-y divide-text-primary/6">
                  {group.items.map((item) => (
                    <li key={item.key}>
                      <EntityRow
                        title={item.title}
                        subtitle={item.subtitle}
                        meta={
                          item.meta ? (
                            <MonoLabel as="span">{item.meta}</MonoLabel>
                          ) : undefined
                        }
                        leading={
                          <MediaCover
                            src={item.imageUrl}
                            alt=""
                            shape={item.kind === "artist" ? "circle" : "square"}
                            fallbackIcon={icons[item.kind]}
                            className="size-12 shrink-0"
                            renderImage={renderImage}
                          />
                        }
                        onOpen={onSelect ? () => onSelect(item) : undefined}
                        openLabel={itemLabel?.(item) ?? item.title}
                        trailing={renderAction?.(item)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <EmptyState message={emptyMessage ?? t("search.noMusicFound")} />
        )
      ) : null}
    </div>
  );
}
