import { useTranslation } from "react-i18next";
import {
  HardDrive,
  Music2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "@crate/ui/icons";

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
        <div className="inline-flex items-center gap-2 rounded-full border border-accent-action/25 bg-accent-action/10 px-3 py-1.5 text-xs font-semibold text-accent-action">
          <HardDrive size={14} aria-hidden="true" />
          {t("offline.access.status")}
        </div>
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
                    <Music2 size={18} aria-hidden="true" />
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
                <button
                  type="button"
                  onClick={() =>
                    playAll(group.tracks, 0, sourceForGroup(group))
                  }
                  className="inline-flex shrink-0 items-center gap-2 rounded-full bg-accent-action px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
                >
                  <Play size={15} aria-hidden="true" />
                  {t("offline.access.playAll")}
                </button>
              </div>
              <ol className="mt-4 divide-y divide-border-quiet/70">
                {group.tracks.map((track, index) => (
                  <li key={track.id}>
                    <button
                      type="button"
                      onClick={() =>
                        playAll(group.tracks, index, sourceForGroup(group))
                      }
                      className="flex w-full items-center gap-3 py-3 text-left transition hover:text-text-accent"
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
                    </button>
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
            <button
              type="button"
              aria-label={t("offline.access.previous")}
              onClick={prev}
              className="rounded-full p-2 text-text-primary hover:bg-text-primary/10"
            >
              <SkipBack size={17} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={isPlaying ? t("player.pause") : t("player.play")}
              onClick={() => (isPlaying ? pause() : resume())}
              className="rounded-full bg-accent-action p-2.5 text-white"
            >
              {isPlaying ? (
                <Pause size={18} aria-hidden="true" />
              ) : (
                <Play size={18} aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              aria-label={t("offline.access.next")}
              onClick={next}
              className="rounded-full p-2 text-text-primary hover:bg-text-primary/10"
            >
              <SkipForward size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
        <label className="mt-3 flex items-center gap-3 text-xs text-text-muted">
          <span className="sr-only">{t("offline.access.seek")}</span>
          <input
            type="range"
            min={0}
            max={Math.max(duration, currentTrack?.duration ?? 0)}
            value={Math.min(currentTime, duration || currentTime)}
            disabled={!currentTrack || state.isBuffering}
            onChange={(event) => seek(Number(event.currentTarget.value))}
            className="h-1.5 min-w-0 flex-1 accent-[var(--color-accent-action)]"
          />
          <span className="w-12 text-right tabular-nums">
            {Math.floor(currentTime / 60)}:
            {String(Math.floor(currentTime % 60)).padStart(2, "0")}
          </span>
        </label>
      </section>
    </main>
  );
}
