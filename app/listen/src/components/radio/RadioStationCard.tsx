import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Radio } from "@crate/ui/icons";

import type { ContextMenuHeader } from "@crate/ui/domain/actions";
import { useEntityMenu } from "@crate/ui/domain/entity/useEntityMenu";
import { ItemActionMenuButton } from "@/components/actions/ItemActionMenu";
import { useListenEntityMenu } from "@/components/actions/entity-menu";
import { buildRadioActions } from "@/components/actions/radio-actions";
import { CrateImage } from "@/components/artwork/CrateImage";
import { cn } from "@/lib/utils";

import {
  radioSeedKind,
  radioStationArtwork,
  radioStationSeedPath,
  radioStationSubtitle,
  radioStationTitle,
  radioTypeLabel,
  type RadioStationLike,
} from "./radio-station-view";

interface RadioStationCardProps {
  station: RadioStationLike;
  onPlay: () => void;
  layout?: "rail" | "grid";
  disabled?: boolean;
  showPlayCount?: boolean;
}

export const RadioStationCard = memo(function RadioStationCard({
  station,
  onPlay,
  layout = "rail",
  disabled = false,
  showPlayCount = false,
}: RadioStationCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const artworkUrl = radioStationArtwork(station);
  const typeLabel = radioTypeLabel(station, t);
  const title = radioStationTitle(station);
  const subtitle = radioStationSubtitle(station);
  const plays = station.play_count || 0;
  const seedKind = radioSeedKind(station);
  const seedPath = radioStationSeedPath(station);

  const onPlayRef = useRef(onPlay);
  useEffect(() => {
    onPlayRef.current = onPlay;
  });
  const getActions = useCallback(
    () =>
      buildRadioActions(
        {
          onStart: () => onPlayRef.current(),
          disabled,
          seedKind,
          seedPath,
        },
        { t, navigate },
      ),
    [disabled, navigate, seedKind, seedPath, t],
  );
  const header = useMemo<ContextMenuHeader>(
    () => ({
      type: "media",
      title,
      subtitle: typeLabel,
      imageUrl: artworkUrl,
      imageAlt: title,
      imageShape: seedKind === "artist" ? "circle" : "square",
      fallbackIcon: Radio,
    }),
    [artworkUrl, seedKind, title, typeLabel],
  );
  const actionMenu = useListenEntityMenu(getActions, header);
  const { controller, targetProps, menu } = useEntityMenu({
    actionMenu,
    disabled,
    getFallbackHeader: () => header,
  });

  return (
    <article
      className={cn(
        "item-action-target home-radio-card group relative w-full min-w-0 overflow-hidden rounded-[12px] text-left",
        layout === "rail" && "snap-start",
        disabled && "opacity-60",
      )}
      data-layout={layout}
      {...targetProps}
    >
      <button
        type="button"
        aria-label={t("radio.station.startAria", {
          label: title,
          type: typeLabel,
        })}
        disabled={disabled}
        onClick={onPlay}
        className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 disabled:cursor-not-allowed"
      >
        {artworkUrl ? (
          <CrateImage
            src={artworkUrl}
            alt=""
            loading="lazy"
            className="aspect-square size-full object-cover object-center transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <span
            className="radio-station-placeholder block aspect-square"
            data-station-type={seedKind}
          />
        )}
        <span className="home-radio-overlay absolute inset-0" />
        <span className="home-radio-badge absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold uppercase tracking-[0.16em] backdrop-blur-md">
          <Radio size={12} className="inline-block" /> {typeLabel}
        </span>
        <span className="absolute inset-x-0 bottom-0 block p-4">
          <span className="home-radio-title block truncate text-sm font-semibold">
            {title}
          </span>
          {subtitle ? (
            <span className="home-radio-subtitle mt-1 line-clamp-2 block text-xs leading-5">
              {subtitle}
            </span>
          ) : null}
          {showPlayCount && plays > 0 ? (
            <span className="home-radio-subtitle mt-1 block text-xs tabular-nums">
              {t("common.playCount", { count: plays })}
            </span>
          ) : null}
        </span>
      </button>
      <ItemActionMenuButton
        buttonRef={controller.triggerRef}
        hasActions={controller.hasActions}
        onClick={controller.openFromTrigger}
        expanded={controller.open}
        title={t("actions.menu.more")}
        className="absolute right-2 top-2 z-20 size-9 rounded-full bg-surface-canvas/40 backdrop-blur-md opacity-90 transition-opacity hover:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100"
      />
      {menu}
    </article>
  );
});
