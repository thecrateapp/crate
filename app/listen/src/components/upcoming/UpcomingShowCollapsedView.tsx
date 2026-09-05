import { useTranslation } from "react-i18next";
import { CalendarCheck, CalendarPlus, Loader2, MapPin } from "@crate/ui/icons";

import { ItemActionMenuButton } from "@/components/actions/ItemActionMenu";
import { CrateImage } from "@/components/artwork/CrateImage";
import { resolveMaybeApiAssetUrl } from "@/lib/api";
import {
  artistBackgroundApiUrl,
  artistPhotoApiUrl,
} from "@/lib/library-routes";

import type { CollapsedViewProps } from "./UpcomingShowCardViewTypes";

function PreloadBackground({ item }: { item: CollapsedViewProps["item"] }) {
  const url = artistBackgroundApiUrl(
    {
      artistId: item.artist_id,
      artistSlug: item.artist_slug,
      artistName: item.artist,
    },
    { size: 1280 },
  );
  if (!url) return null;
  return <CrateImage src={url} alt="" className="hidden" />;
}

export function UpcomingShowCollapsedView({
  item,
  attending,
  savingAttendance,
  actionMenu,
  onToggleAttendance,
}: CollapsedViewProps) {
  const { t, i18n } = useTranslation();
  const artistImageUrl =
    artistPhotoApiUrl(
      {
        artistId: item.artist_id,
        artistSlug: item.artist_slug,
        artistName: item.artist,
      },
      { size: 320 },
    ) ||
    resolveMaybeApiAssetUrl(item.cover_url) ||
    undefined;

  const d = item.date ? new Date(`${item.date}T12:00:00`) : null;
  const monthStr = d
    ? d.toLocaleDateString(i18n.language, { month: "short" }).toUpperCase()
    : "";
  const dayStr = d ? String(d.getDate()) : "";
  const dowStr = d
    ? d.toLocaleDateString(i18n.language, { weekday: "short" }).toUpperCase()
    : "";
  const support = (item.lineup || []).slice(1);

  return (
    <div className="absolute inset-x-0 top-0 z-10 flex h-full items-center gap-0">
      <PreloadBackground item={item} />
      <div className="h-full w-[88px] flex-shrink-0 bg-text-primary/5">
        {artistImageUrl && (
          <CrateImage
            src={artistImageUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        )}
      </div>

      <div className="min-w-0 flex-1 px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold text-text-primary">
            {item.artist}
          </span>
          {attending && (
            <span
              className="h-[6px] w-[6px] flex-shrink-0 rounded-full bg-accent-action"
              title={t("radar.show.attending")}
            />
          )}
        </div>
        <div className="mt-1 flex items-center gap-1 text-[11px] text-text-primary/40">
          <MapPin size={10} className="flex-shrink-0 text-accent-action/60" />
          <span className="truncate">{item.venue}</span>
          {item.city && (
            <>
              <span className="text-text-primary/15">&middot;</span>
              <span className="flex-shrink-0">{item.city}</span>
            </>
          )}
        </div>
        {support.length > 0 && (
          <div className="mt-0.5 truncate text-[10px] text-text-primary/40">
            {t("radar.show.withSupportPrefix")} {support.slice(0, 3).join(", ")}
            {support.length > 3 && ` +${support.length - 3}`}
          </div>
        )}
      </div>

      <div className="flex flex-shrink-0 flex-col items-center justify-center px-2">
        <span className="text-[8px] font-bold leading-none tracking-[0.12em] text-accent-action/55">
          {monthStr}
        </span>
        <span className="text-[20px] font-black leading-tight text-accent-action">
          {dayStr}
        </span>
        <span className="text-[8px] font-medium leading-none text-text-primary/40">
          {dowStr}
        </span>
      </div>

      <div className="flex flex-shrink-0 flex-col items-center gap-1 pr-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            void onToggleAttendance();
          }}
          disabled={!item.id || savingAttendance}
          title={
            attending
              ? t("radar.show.attending")
              : t("actions.show.markAttending")
          }
          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-primary/30 transition-colors hover:bg-text-primary/8 hover:text-text-primary/60 disabled:opacity-30"
        >
          {savingAttendance ? (
            <Loader2 size={15} className="animate-spin" />
          ) : attending ? (
            <CalendarCheck size={15} className="text-accent-action" />
          ) : (
            <CalendarPlus size={15} />
          )}
        </button>
        <ItemActionMenuButton
          buttonRef={actionMenu.triggerRef}
          hasActions={actionMenu.hasActions}
          onClick={actionMenu.onOpen}
          className="h-7 w-7 opacity-40 transition-opacity hover:opacity-80"
        />
      </div>
    </div>
  );
}
