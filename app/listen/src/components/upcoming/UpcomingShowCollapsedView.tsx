import { useTranslation } from "react-i18next";
import {
  CalendarCheck,
  CalendarPlus,
  CRATE_ICON_SIZE,
  Loader2,
  MapPin,
} from "@crate/ui/icons";
import { IconButton } from "@crate/ui/primitives/IconButton";

import { ItemActionMenuButton } from "@/components/actions/ItemActionMenu";
import { ArtworkSurface } from "@/components/artwork/ArtworkSurface";
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

function CollapsedShowArtwork({ artistImageUrl }: { artistImageUrl?: string }) {
  return (
    <ArtworkSurface
      source={artistImageUrl ?? null}
      alt=""
      imageClassName="object-cover"
      imageProps={{ loading: "lazy" }}
      className="h-full w-[88px] shrink-0 bg-text-primary/5"
      fallback={null}
    />
  );
}

function CollapsedShowDetails({
  item,
  attending,
}: {
  item: CollapsedViewProps["item"];
  attending: boolean;
}) {
  const { t } = useTranslation();
  const support = (item.lineup || []).slice(1);

  return (
    <span className="block min-w-0 flex-1 px-3 py-2.5">
      <span className="flex items-center gap-1.5">
        <span className="truncate text-caption font-semibold text-text-primary">
          {item.artist}
        </span>
        {attending && (
          <span
            className="size-[6px] shrink-0 rounded-full bg-accent-action"
            title={t("radar.show.attending")}
          />
        )}
      </span>
      <span className="mt-1 flex items-center gap-1 text-xs text-text-primary/40">
        <MapPin
          size={CRATE_ICON_SIZE.nano}
          className="shrink-0 text-accent-action/60"
        />
        <span className="truncate">{item.venue}</span>
        {item.city && (
          <>
            <span className="text-text-primary/15">&middot;</span>
            <span className="shrink-0">{item.city}</span>
          </>
        )}
      </span>
      {support.length > 0 && (
        <span className="mt-0.5 block truncate text-xs text-text-primary/40">
          {t("radar.show.withSupportPrefix")} {support.slice(0, 3).join(", ")}
          {support.length > 3 && ` +${support.length - 3}`}
        </span>
      )}
    </span>
  );
}

function CollapsedShowDate({
  item,
  locale,
}: {
  item: CollapsedViewProps["item"];
  locale: string;
}) {
  const date = item.date ? new Date(`${item.date}T12:00:00`) : null;
  const month = date
    ? date.toLocaleDateString(locale, { month: "short" }).toUpperCase()
    : "";
  const day = date ? String(date.getDate()) : "";
  const weekday = date
    ? date.toLocaleDateString(locale, { weekday: "short" }).toUpperCase()
    : "";

  return (
    <span className="flex shrink-0 flex-col items-center justify-center px-2">
      <span className="text-xs font-bold leading-none tracking-label text-accent-action/55">
        {month}
      </span>
      <span className="text-[1.25rem] font-black leading-tight text-accent-action">
        {day}
      </span>
      <span className="text-xs font-medium leading-none text-text-primary/40">
        {weekday}
      </span>
    </span>
  );
}

function CollapsedShowActions({
  item,
  attending,
  savingAttendance,
  actionMenu,
  onToggleAttendance,
}: Omit<CollapsedViewProps, "onToggle">) {
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 flex-col items-center gap-1 pr-2">
      <IconButton
        size="sm"
        onClick={() => {
          void onToggleAttendance();
        }}
        disabled={!item.id || savingAttendance}
        aria-pressed={attending}
        active={false}
        label={
          attending
            ? t("radar.show.attending")
            : t("actions.show.markAttending")
        }
        className="rounded-lg text-text-primary/30 hover:bg-text-primary/8 hover:text-text-primary/60 disabled:opacity-30"
      >
        {savingAttendance ? (
          <Loader2 size={CRATE_ICON_SIZE.sm} className="animate-spin" />
        ) : attending ? (
          <CalendarCheck
            size={CRATE_ICON_SIZE.sm}
            className="text-accent-action"
          />
        ) : (
          <CalendarPlus size={CRATE_ICON_SIZE.sm} />
        )}
      </IconButton>
      <ItemActionMenuButton
        buttonRef={actionMenu.triggerRef}
        hasActions={actionMenu.hasActions}
        onClick={actionMenu.onOpen}
        expanded={actionMenu.open}
        title={t("actions.menu.more")}
        className=" size-7 opacity-40 transition-opacity hover:opacity-80"
      />
    </div>
  );
}

export function UpcomingShowCollapsedView({
  item,
  attending,
  savingAttendance,
  actionMenu,
  onToggleAttendance,
  onToggle,
}: CollapsedViewProps) {
  const { i18n } = useTranslation();
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

  return (
    <div className="absolute inset-x-0 top-0 z-10 flex h-full items-center gap-0">
      <PreloadBackground item={item} />
      <button
        type="button"
        aria-expanded={false}
        onClick={onToggle}
        className="flex h-full min-w-0 flex-1 items-center rounded-l-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
      >
        <CollapsedShowArtwork artistImageUrl={artistImageUrl} />
        <CollapsedShowDetails item={item} attending={attending} />
        <CollapsedShowDate item={item} locale={i18n.language} />
      </button>
      <CollapsedShowActions
        item={item}
        attending={attending}
        savingAttendance={savingAttendance}
        actionMenu={actionMenu}
        onToggleAttendance={onToggleAttendance}
      />
    </div>
  );
}
