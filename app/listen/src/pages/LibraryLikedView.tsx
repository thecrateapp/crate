import { useTranslation } from "react-i18next";
import { FilterBar } from "@crate/ui/domain/filters";
import { TrackList, type TrackListProps } from "@crate/ui/domain/tracks";
import { CRATE_ICON_SIZE, Play } from "@crate/ui/icons";
import { FormField } from "@crate/ui/primitives/FormField";
import { SearchInput } from "@crate/ui/primitives/SearchInput";
import { Button } from "@crate/ui/shadcn/button";
import { CollectionSortDropdown } from "./LibraryCollectionSortDropdown";
import { likedSortOptions, type LikedSort } from "./library-collection-model";

/** Collection presentation shared with the review; fetching and playback stay in the page. */
export function LibraryLikedView<T>({
  search,
  onSearch,
  sort,
  onSort,
  totalCount,
  onPlay,
  ...list
}: Pick<
  TrackListProps<T>,
  "items" | "itemKey" | "renderRow" | "virtualList"
> & {
  search: string;
  onSearch: (value: string) => void;
  sort: LikedSort;
  onSort: (value: LikedSort) => void;
  totalCount: number;
  onPlay: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <FilterBar
        align="end"
        leading={
          <Button onClick={onPlay}>
            <Play size={CRATE_ICON_SIZE.sm} fill="currentColor" />
            {list.items.length < totalCount
              ? t("library.liked.playFiltered", { count: list.items.length })
              : t("library.liked.playAll")}
          </Button>
        }
        search={
          <FormField kind="group" label={t("search.label")}>
            {(group) => (
              <div {...group} role="group">
                <SearchInput
                  value={search}
                  onValueChange={onSearch}
                  label={t("library.liked.filterPlaceholder")}
                  clearLabel={t("search.clear")}
                  placeholder={t("library.liked.filterPlaceholder")}
                />
              </div>
            )}
          </FormField>
        }
        sort={
          <FormField kind="group" label={t("library.sort.label")}>
            {(group) => (
              <div {...group} role="group">
                <CollectionSortDropdown
                  label={t("library.sort.likedTracks")}
                  value={sort}
                  options={likedSortOptions}
                  onChange={onSort}
                />
              </div>
            )}
          </FormField>
        }
      />
      <TrackList {...list} />
    </div>
  );
}
