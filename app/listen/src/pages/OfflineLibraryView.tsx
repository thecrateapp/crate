import {
  formatTrackAnalysis,
  formatMusicalKey,
} from "@crate/ui/lib/track-meta";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  CRATE_ICON_SIZE,
  HardDrive,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "@crate/ui/icons";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { SectionHeader } from "@crate/ui/domain/lists/SectionHeader";
import { EmptyState } from "@crate/ui/domain/lists/EmptyState";
import { TrackList } from "@crate/ui/domain/tracks/TrackList";
import {
  MediaCover,
  type MediaCoverProps,
} from "@crate/ui/domain/media/MediaCover";
import { ActionButton, ActionGroup } from "@crate/ui/primitives/ActionGroup";
import { Button } from "@crate/ui/shadcn/button";
import { TrackRowView } from "../components/cards/TrackRowView";
import { TrackRowContent } from "../components/cards/TrackRowContent";
import { TrackRowPlaybackControl } from "../components/cards/TrackRowPlaybackControl";
import { SpectrumPlayButton } from "../components/player/SpectrumPlayButton";
import { getQualityBadge } from "../components/player/bar/player-bar-utils";
import { formatDuration } from "../lib/utils";

export interface OfflineGroupView {
  key: string;
  title: string;
  tracks: {
    id: number | string;
    title: string;
    artist: string;
    albumCover?: string;
    duration?: number;
    format?: string;
    bitrate?: number | null;
    sampleRate?: number | null;
    bitDepth?: number | null;
    bpm?: number | null;
    audioKey?: string | null;
    audioScale?: string | null;
  }[];
}
export function OfflineLibraryView({
  groups,
  currentTrack,
  isPlaying,
  isBuffering,
  onPlay,
  onPause,
  onResume,
  onPrevious,
  onNext,
  progress,
  activeGlyph,
  reconnect,
  renderImage,
}: {
  groups: OfflineGroupView[];
  currentTrack?: { id: number | string; title: string; artist: string } | null;
  isPlaying: boolean;
  isBuffering: boolean;
  onPlay: (group: number, track: number) => void;
  onPause: () => void;
  onResume: () => void;
  onPrevious: () => void;
  onNext: () => void;
  progress: ReactNode;
  activeGlyph?: ReactNode;
  reconnect?: ReactNode;
  renderImage?: MediaCoverProps["renderImage"];
}) {
  const { t } = useTranslation();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-8 px-4 py-8 sm:px-6">
      <PageHeader
        title={t("offline.access.title")}
        subtitle={t("offline.access.subtitle")}
        eyebrow={
          <InfoBadge icon={HardDrive}>{t("offline.access.status")}</InfoBadge>
        }
        actions={reconnect}
      />
      {groups.length ? (
        groups.map((group, groupIndex) => (
          <section
            key={group.key}
            className="grid gap-4"
            aria-label={group.title}
          >
            <SectionHeader
              title={group.title}
              count={t("common.trackCount", { count: group.tracks.length })}
              action={
                <Button onClick={() => onPlay(groupIndex, 0)}>
                  <Play size={CRATE_ICON_SIZE.md} />
                  {t("offline.access.playAll")}
                </Button>
              }
            />
            <TrackList
              role="list"
              aria-label={group.title}
              items={group.tracks}
              itemKey={(track) => track.id}
              renderRow={(track, index) => {
                const active = currentTrack?.id === track.id;
                const play = () =>
                  active
                    ? isPlaying
                      ? onPause()
                      : onResume()
                    : onPlay(groupIndex, index);
                return (
                  <TrackRowView
                    role="listitem"
                    active={active}
                    onClick={play}
                    onKeyDown={(event) => {
                      if (
                        event.target === event.currentTarget &&
                        (event.key === "Enter" || event.key === " ")
                      ) {
                        event.preventDefault();
                        play();
                      }
                    }}
                  >
                    <TrackRowContent
                      title={track.title}
                      meta={track.artist}
                      actions={null}
                      quality={getQualityBadge({
                        ...track,
                        id: String(track.id),
                      })}
                      tempo={formatTrackAnalysis(track.bpm)}
                      musicalKey={formatMusicalKey(
                        track.audioKey,
                        track.audioScale,
                      )}
                      duration={
                        track.duration != null &&
                        Number.isFinite(track.duration) &&
                        track.duration > 0
                          ? formatDuration(track.duration)
                          : undefined
                      }
                      leading={
                        <TrackRowPlaybackControl
                          disabled={false}
                          index={index + 1}
                          isActive={active}
                          isPlaying={isPlaying}
                          label={
                            active && isPlaying
                              ? `${t("player.pause")}: ${track.title} — ${track.artist}`
                              : t("common.playItem", {
                                  name: `${track.title} — ${track.artist}`,
                                })
                          }
                          artwork={
                            <MediaCover
                              src={track.albumCover}
                              renderImage={renderImage}
                              alt={track.title}
                              className="size-12"
                            />
                          }
                          activeGlyph={activeGlyph}
                          onClick={(event) => {
                            event.stopPropagation();
                            play();
                          }}
                        />
                      }
                    />
                  </TrackRowView>
                );
              }}
            />
          </section>
        ))
      ) : (
        <EmptyState message={t("offline.access.empty")} />
      )}
      <section
        className="sticky bottom-4 mt-auto grid gap-3 rounded-panel border border-border-subtle bg-surface-chrome p-4"
        aria-label={t("player.queue")}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate font-display text-base font-bold">
              {currentTrack?.title || t("offline.access.title")}
            </p>
            <p className="text-sm text-text-muted">
              {currentTrack?.artist || t("offline.access.status")}
            </p>
          </div>
          <ActionGroup label={t("player.queue")}>
            <ActionButton
              label={t("offline.access.previous")}
              onClick={onPrevious}
              disabled={!currentTrack}
            >
              <SkipBack size={CRATE_ICON_SIZE.lg} />
            </ActionButton>
            <div className="flex size-11 items-center justify-center">
              <SpectrumPlayButton
                size="sm"
                aria-label={isPlaying ? t("player.pause") : t("player.play")}
                active={isPlaying}
                disabled={!currentTrack || isBuffering}
                onClick={isPlaying ? onPause : onResume}
              >
                {isPlaying ? (
                  <Pause size={CRATE_ICON_SIZE.md} fill="currentColor" />
                ) : (
                  <Play size={CRATE_ICON_SIZE.md} fill="currentColor" />
                )}
              </SpectrumPlayButton>
            </div>
            <ActionButton
              label={t("offline.access.next")}
              onClick={onNext}
              disabled={!currentTrack}
            >
              <SkipForward size={CRATE_ICON_SIZE.lg} />
            </ActionButton>
          </ActionGroup>
        </div>
        {progress}
      </section>
    </main>
  );
}
