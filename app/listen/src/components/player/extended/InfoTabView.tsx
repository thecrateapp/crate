import type { PlayerQualityPresentation } from "../player-quality-context";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@crate/ui/lib/cn";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import { EmptyState } from "@crate/ui/domain/lists/EmptyState";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import type { Track } from "../../../contexts/player-types";
import type { TrackInfo } from "../../../lib/track-info-data";
import {
  getTrackQualityFromInfo,
  mergeTrackQualityParts,
} from "../../../lib/track-info-data";
import { getQualityBadge } from "../bar/player-bar-utils";
import { QualityBadge } from "../bar/QualityBadge";
import { InfoTabHero } from "./InfoTabHero";
import { InfoTabAnalysisGrid } from "./InfoTabSections";
import { InfoTabReach } from "./InfoTabReach";
import {
  formatBitDepth,
  formatBitrate,
  formatSampleRate,
  parseMoodEntries,
} from "./info-tab-data";
export function InfoTabView({
  info,
  currentTrack,
  loading,
  error = false,
  onRetry,
  artwork,
  onOpenArtist,
  onOpenAlbum,
  className,
  playbackQuality,
}: {
  playbackQuality?: PlayerQualityPresentation | null;
  info: TrackInfo | null;
  currentTrack: Track | undefined;
  loading: boolean;
  error?: boolean;
  onRetry?: () => void;
  artwork?: ReactNode;
  onOpenArtist?: () => void;
  onOpenAlbum?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const quality = mergeTrackQualityParts(
    currentTrack,
    getTrackQualityFromInfo(info),
    playbackQuality?.source,
  );
  const sourceBadge = getQualityBadge(quality);
  const badge = playbackQuality ? playbackQuality.badge : sourceBadge;
  const pills = [
    quality.format?.toUpperCase(),
    formatBitrate(quality.bitrate),
    formatSampleRate(quality.sampleRate),
    formatBitDepth(quality.bitDepth),
  ].filter((value): value is string => !!value);
  return (
    <div
      className={cn(
        "hide-rail-scrollbar @container h-full min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain pr-1",
        className,
      )}
    >
      {loading ? (
        <LoadingState fullWidth label={t("player.info.loading")} />
      ) : error ? (
        <ErrorState
          message={t("player.info.error")}
          onRetry={onRetry}
          retryLabel={t("common.retry")}
        />
      ) : !info || !currentTrack ? (
        <EmptyState title={t("player.info.empty")} />
      ) : (
        <div className="grid min-w-0 gap-8 pb-2">
          <InfoTabHero
            info={info}
            currentTrack={currentTrack}
            artwork={artwork}
            qualityBadge={
              badge ? (
                <QualityBadge badge={badge} origin={playbackQuality?.origin} />
              ) : undefined
            }
            qualityLabel={t(
              playbackQuality
                ? "player.info.playbackQuality"
                : "player.info.metric.source",
            )}
            onOpenArtist={onOpenArtist}
            onOpenAlbum={onOpenAlbum}
          />
          <InfoTabAnalysisGrid
            info={info}
            topMoods={parseMoodEntries(info.mood_json).slice(0, 5)}
            hasAnalysis={[info.energy, info.danceability, info.valence].some(
              (value) => value != null,
            )}
            qualityPills={pills}
            sourceBadge={
              sourceBadge ? <QualityBadge badge={sourceBadge} /> : undefined
            }
          />
          <InfoTabReach info={info} />
        </div>
      )}
    </div>
  );
}
