import {
  CatalogSearchView,
  type CatalogSearchProps,
} from "../search/CatalogSearchView";
import { catalogTrackItem } from "../search/catalog-search-model";
import { CRATE_ICON_SIZE, Plus } from "@crate/ui/icons";
import type { useTranslation } from "react-i18next";
import type { SearchTrackResult } from "./playlist-composer-model";
export function PlaylistTrackSearchView({
  search,
  searching,
  results,
  t,
  onSearchChange,
  onAddTrack,
}: {
  search: string;
  searching: boolean;
  results: SearchTrackResult[];
  t: ReturnType<typeof useTranslation>["t"];
  onSearchChange: (value: string) => void;
  onAddTrack: (track: SearchTrackResult) => void;
}) {
  return (
    <CatalogSearchView
      {...playlistTrackSearchProps({
        search,
        searching,
        results,
        t,
        onSearchChange,
        onAddTrack,
      })}
    />
  );
}
export function playlistTrackSearchProps({
  search,
  searching,
  results,
  t,
  onSearchChange,
  onAddTrack,
}: Parameters<
  typeof PlaylistTrackSearchView
>[0]): CatalogSearchProps<SearchTrackResult> {
  return {
    label: t("playlistComposer.searchPlaceholder"),
    query: search,
    searching,
    items: results.map(catalogTrackItem),
    kinds: ["track"],
    onQueryChange: onSearchChange,
    onSelect: (item) => onAddTrack(item.data),
    itemLabel: (item) => `${t("common.add")}: ${item.title}`,
    renderAction: () => <Plus aria-hidden="true" size={CRATE_ICON_SIZE.md} />,
    emptyMessage: t("playlistComposer.noTracksFound"),
  };
}
