import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Disc, Music, User } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";
import { ArtworkSurface } from "@/components/artwork/ArtworkSurface";
import type {
  TopBarSearchItem,
  TopBarSearchRecentEntry,
} from "./topbar-search-model";
import {
  TopBarSearchDropdownView,
  type TopBarSearchDropdownViewProps,
} from "./TopBarSearchDropdownView";
export function SearchResultThumb({ item }: { item: TopBarSearchItem }) {
  const FallbackIcon =
    item.type === "artist" ? User : item.type === "album" ? Disc : Music;
  const fallback = (
    <FallbackIcon
      size={CRATE_ICON_SIZE.md}
      className="block size-8 p-1.5 text-text-primary/30"
    />
  );
  const shapeClassName = item.type === "artist" ? "rounded-full" : "rounded";

  if (item.imageUrl) {
    return (
      <ArtworkSurface
        source={item.imageUrl}
        alt=""
        fallback={fallback}
        imageClassName="object-cover"
        className={cn(
          "crate-media-thumbnail size-12 shrink-0 bg-text-primary/5",
          shapeClassName,
        )}
      />
    );
  }
  return (
    <span
      className={cn(
        "crate-media-thumbnail size-12 shrink-0 bg-text-primary/5",
        shapeClassName,
      )}
    >
      {fallback}
    </span>
  );
}

export function TopBarSearchDropdown(
  props: Omit<
    TopBarSearchDropdownViewProps<TopBarSearchItem, TopBarSearchRecentEntry>,
    "t" | "renderThumb"
  >,
) {
  const { t } = useTranslation();
  return (
    <TopBarSearchDropdownView
      {...props}
      t={t}
      renderThumb={(item) => <SearchResultThumb item={item} />}
    />
  );
}
