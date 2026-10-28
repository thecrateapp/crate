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
  placeholder?: string;
  disabled?: boolean;
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
  genre: "common.genre",
} as const;
const findingKeys = {
  artist: "search.findingArtists",
  album: "search.findingAlbums",
  track: "search.findingTracks",
  genre: "search.findingGenres",
} as const;
const icons = { artist: User, album: Disc3, track: Music2, genre: Music2 };
/** Controlled domain search. Owning controllers retain debounce, transport and selection authority. */
export function CatalogSearchView<T>({
  label,
  placeholder,
  disabled = false,
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
  const uniqueKinds = [...new Set(kinds)];
  const loadingLabel = t(
    uniqueKinds.length === 1
      ? findingKeys[uniqueKinds[0]!]
      : "search.loadingResults",
  );
  const groups = uniqueKinds
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
            placeholder={placeholder ?? label}
            disabled={disabled}
            clearLabel={t("search.clear")}
            value={query}
            onValueChange={onQueryChange}
          />
        )}
      </FormField>
      {query.trim().length >= 2 ? (
        searching && !groups.length ? (
          <LoadingState label={loadingLabel} fullWidth />
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
            {searching ? <LoadingState label={loadingLabel} fullWidth /> : null}
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
                        disabled={disabled}
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
                            size={48}
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
