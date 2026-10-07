import { useTranslation } from "react-i18next";
import {
  CRATE_ICON_SIZE,
  HardDrive,
  Music2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "@crate/ui/icons";
import { IconButton } from "@crate/ui/primitives/IconButton";
import { Button } from "@crate/ui/shadcn/button";

import { PlayerSeekBar } from "@/components/player/bar/PlayerSeekBar";
import {
  usePlayerActions,
  usePlayerProgress,
  usePlayerState,
} from "@/contexts/PlayerContext";
import { useOffline } from "@/contexts/OfflineContext";
import {
  buildOfflineLibraryGroups,
  type OfflineLibraryGroup,
} from "@/pages/offline-library-model";
import { CrateBadge } from "@crate/ui/primitives/CrateBadge";

function sourceForGroup(group: OfflineLibraryGroup) {
  const { item } = group;
  return {
    type:
      item.kind === "album"
        ? ("album" as const)
        : item.kind === "playlist"
          ? ("playlist" as const)
          : ("track" as const),
    name: item.title,
    id: item.entityId,
  };
}

export function OfflineLibrary() {
  const { t } = useTranslation();
  const { items } = useOffline();
  const { playAll, currentTrack, pause, resume, next, prev, seek } =
    usePlayerActions();
  const { currentTime, duration } = usePlayerProgress();
  const state = usePlayerState();
  const { isPlaying } = state;
  const groups = buildOfflineLibraryGroups(items);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-8 text-text-primary sm:px-8">
      <header className="space-y-3">
        <CrateBadge size="md" icon={HardDrive}>
          {t("offline.access.status")}
        </CrateBadge>
        <div>
          <h1 className="text-3xl font-bold">{t("offline.access.title")}</h1>
          <p className="mt-2 text-sm text-text-muted">
            {t("offline.access.subtitle")}
          </p>
        </div>
      </header>

      {groups.length ? (
        <section className="space-y-3" aria-label={t("offline.access.title")}>
          {groups.map((group) => (
            <article
              key={`${group.item.kind}:${group.item.entityId}`}
              className="rounded-xl border border-border-quiet bg-surface-solid p-4 sm:p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-text-primary/[0.06] text-text-muted">
                    <Music2 size={CRATE_ICON_SIZE.md} aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold">
                      {group.item.title}
                    </h2>
                    <p className="mt-1 text-sm text-text-muted">
                      {t("common.trackCount", { count: group.tracks.length })}
                    </p>
                  </div>
                </div>
                <Button
                  shape="pill"
                  onClick={() =>
                    playAll(group.tracks, 0, sourceForGroup(group))
                  }
                  className="font-semibold"
                >
                  <Play size={CRATE_ICON_SIZE.sm} aria-hidden="true" />
                  {t("offline.access.playAll")}
                </Button>
              </div>
              <ol className="mt-4 divide-y divide-border-quiet/70">
                {group.tracks.map((track, index) => (
                  <li key={track.id}>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        playAll(group.tracks, index, sourceForGroup(group))
                      }
                      className="h-auto w-full justify-start gap-3 rounded-none px-0 py-3 text-left font-normal text-text-primary hover:bg-transparent hover:text-text-accent dark:hover:bg-transparent"
                    >
                      <span className="w-6 shrink-0 text-right text-xs text-text-muted">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {track.title}
                      </span>
                      <span className="max-w-[40%] truncate text-xs text-text-muted">
                        {track.artist}
                      </span>
                    </Button>
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </section>
      ) : (
        <p className="rounded-xl border border-border-quiet bg-surface-solid p-5 text-sm text-text-muted">
          {t("offline.access.empty")}
        </p>
      )}

      <section
        className="sticky bottom-4 mt-auto rounded-xl border border-border-quiet bg-surface-chrome p-4 shadow-chrome backdrop-blur-xl"
        aria-label={t("player.queue")}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {currentTrack?.title || t("offline.access.title")}
            </p>
            <p className="truncate text-xs text-text-muted">
              {currentTrack?.artist || t("offline.access.status")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <IconButton
              label={t("offline.access.previous")}
              onClick={prev}
              className="rounded-full text-text-primary"
            >
              <SkipBack size={CRATE_ICON_SIZE.md} aria-hidden="true" />
            </IconButton>
            <IconButton
              label={isPlaying ? t("player.pause") : t("player.play")}
              onClick={() => (isPlaying ? pause() : resume())}
              className="rounded-full bg-accent-action text-accent-action-foreground hover:text-accent-action-foreground"
            >
              {isPlaying ? (
                <Pause size={CRATE_ICON_SIZE.md} aria-hidden="true" />
              ) : (
                <Play size={CRATE_ICON_SIZE.md} aria-hidden="true" />
              )}
            </IconButton>
            <IconButton
              label={t("offline.access.next")}
              onClick={next}
              className="rounded-full text-text-primary"
            >
              <SkipForward size={CRATE_ICON_SIZE.md} aria-hidden="true" />
            </IconButton>
          </div>
        </div>
        <PlayerSeekBar
          className="mt-3"
          currentTime={currentTime}
          duration={Math.max(duration, currentTrack?.duration ?? 0)}
          onSeek={seek}
          disabled={!currentTrack || state.isBuffering}
          compact
          showTimes
        />
      </section>
    </main>
  );
}
