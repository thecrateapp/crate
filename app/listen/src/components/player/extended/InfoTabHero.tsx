import type { ReactNode } from "react";
import type { Track } from "../../../contexts/player-types";
import type { TrackInfo } from "../../../lib/track-info-data";
import { InfoTabHeroIdentity } from "./InfoTabHeroIdentity";
import { InfoTabHeroRating } from "./InfoTabHeroRating";
import { InfoTabHeroStats } from "./InfoTabHeroStats";
export function InfoTabHero({
  info,
  currentTrack,
  artwork,
  qualityBadge,
  qualityLabel,
  onOpenArtist,
  onOpenAlbum,
}: {
  info: TrackInfo;
  currentTrack: Track;
  artwork?: ReactNode;
  qualityBadge?: ReactNode;
  qualityLabel?: string;
  onOpenArtist?: () => void;
  onOpenAlbum?: () => void;
}) {
  return (
    <section
      className="grid min-w-0 gap-6"
      aria-label={info.title || currentTrack.title}
    >
      <div className="flex min-w-0 flex-wrap items-start gap-4">
        {artwork}
        <InfoTabHeroIdentity
          info={info}
          currentTrack={currentTrack}
          qualityBadge={qualityBadge}
          qualityLabel={qualityLabel}
          onOpenArtist={onOpenArtist}
          onOpenAlbum={onOpenAlbum}
        />
      </div>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-6">
        <InfoTabHeroStats info={info} />
        <InfoTabHeroRating rating={info.rating} />
      </div>
    </section>
  );
}
