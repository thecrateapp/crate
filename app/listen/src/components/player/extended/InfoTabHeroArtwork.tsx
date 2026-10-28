import { useTranslation } from "react-i18next";
import { InfoTabHeroArtworkView } from "./InfoTabHeroArtworkView";

import { ArtworkSurface } from "@/components/artwork/ArtworkSurface";
import type { Track } from "@/contexts/player-types";

export function InfoTabHeroArtwork({
  currentTrack,
  albumName,
}: {
  currentTrack: Track;
  albumName: string | undefined;
}) {
  const { t } = useTranslation();
  return (
    <InfoTabHeroArtworkView
      src={currentTrack.albumCover}
      alt={t("player.info.albumCoverAlt", {
        name: albumName || currentTrack.title,
      })}
      renderImage={({ src, alt, className, fallback }) => (
        <ArtworkSurface
          source={src}
          alt={alt}
          className="size-full"
          imageClassName={className}
          imageProps={{ width: 112, height: 112, loading: "lazy" }}
          fallback={fallback}
        />
      )}
    />
  );
}
