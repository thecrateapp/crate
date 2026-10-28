import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Radio } from "@crate/ui/icons";

import type { ContextMenuHeader } from "@crate/ui/domain/actions";
import { useListenEntityMenu } from "@/components/actions/entity-menu";
import { buildRadioActions } from "@/components/actions/radio-actions";
import { CrateImage } from "@/components/artwork/CrateImage";
import { RadioStationCardView } from "./RadioStationCardView";

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
  disabled = false,
  showPlayCount = false,
}: RadioStationCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const artworkUrl = radioStationArtwork(station);
  const typeLabel = radioTypeLabel(station, t);
  const title = radioStationTitle(station);
  const subtitle = radioStationSubtitle(station, t);
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
  return (
    <RadioStationCardView
      title={title}
      subtitle={subtitle}
      typeLabel={typeLabel}
      artworkUrl={artworkUrl}
      playCount={showPlayCount ? station.play_count : undefined}
      disabled={disabled}
      onPlay={onPlay}
      openLabel={t("radio.station.startAria", {
        label: title,
        type: typeLabel,
      })}
      actionMenu={actionMenu}
      renderImage={({ src, alt, ...props }) => (
        <CrateImage {...props} src={src} alt={alt} loading="lazy" />
      )}
    />
  );
});
