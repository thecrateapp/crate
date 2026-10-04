import { useTranslation } from "react-i18next";
import { CratePill } from "@crate/ui/primitives/CrateBadge";

import { ArtworkSurface } from "@/components/artwork/ArtworkSurface";
import { resolveMaybeApiAssetUrl } from "@/lib/api";

import type { HomeUpcomingItem } from "./home-model";

const LAZY_IMAGE_PROPS = { loading: "lazy" } as const;

export function UpcomingPreviewRow({
  item,
  onClick,
}: {
  item: HomeUpcomingItem;
  onClick: () => void;
}) {
  const { t, i18n } = useTranslation();
  const dateLabel = item.date
    ? new Date(`${item.date}T12:00:00`).toLocaleDateString(i18n.language, {
        month: "short",
        day: "numeric",
      })
    : t("home.radar.soon");
  const artworkUrl = resolveMaybeApiAssetUrl(item.cover_url);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex w-full items-center gap-3 overflow-hidden rounded-lg border border-transparent px-3 py-2 text-left transition-colors hover:border-border-quiet hover:bg-text-primary/5"
    >
      {artworkUrl ? (
        <ArtworkSurface
          source={artworkUrl}
          alt=""
          fallback={null}
          imageProps={LAZY_IMAGE_PROPS}
          imageClassName="object-cover"
          className="absolute inset-0 opacity-20 grayscale transition-opacity group-hover:opacity-30"
        />
      ) : null}
      <div className="home-upcoming-row-scrim absolute inset-0" />
      <div className="relative flex size-11 shrink-0 flex-col items-center justify-center rounded-xl border border-border-quiet bg-text-primary/[0.03]">
        <span className="text-xs uppercase tracking-wide text-text-primary/40">
          {dateLabel.split(" ")[0]}
        </span>
        <span className="text-sm font-semibold text-text-primary">
          {dateLabel.split(" ")[1] || ""}
        </span>
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-text-primary">
            {item.type === "show" ? item.artist : item.title}
          </span>
          {item.user_attending && item.type === "show" ? (
            <CratePill
              tone="accent"
              className="px-2 py-0.5 text-xs font-medium"
            >
              {t("radar.show.going")}
            </CratePill>
          ) : null}
        </div>
        <div className="truncate text-xs text-text-muted">
          {item.type === "show"
            ? `${item.title} · ${item.subtitle}`
            : `${item.artist} · ${item.title}`}
        </div>
      </div>
      <CratePill
        tone="accent"
        className="relative shrink-0 px-2 py-1 text-xs font-medium uppercase tracking-caps"
      >
        {item.type === "show"
          ? t("home.radar.itemType.show")
          : t("home.radar.itemType.release")}
      </CratePill>
    </button>
  );
}
