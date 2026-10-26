import { useTranslation } from "react-i18next";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import { EmptyState } from "@crate/ui/domain/lists/EmptyState";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import type { LyricsData } from "./extended/lyrics-data";
import { PlayerLyricsSurface } from "./PlayerLyricsSurface";
import { SyncedLyrics } from "./SyncedLyrics";

/** The actual drawer/fullscreen content; adapters retain fetching and playback authority. */
export function PlayerLyricsContent({
  lyrics,
  loading,
  error = false,
  onRetry,
  presentation,
  onSeek,
}: {
  lyrics: LyricsData | null;
  loading: boolean;
  error?: boolean;
  onRetry?: () => void;
  presentation: "drawer" | "fullscreen";
  onSeek: (time: number) => void;
}) {
  const { t } = useTranslation();
  const synced = lyrics?.synced?.length ? lyrics.synced : null;
  const fullscreen = presentation === "fullscreen";
  return (
    <PlayerLyricsSurface
      masked={fullscreen && !loading && !error && Boolean(synced)}
      className="px-1"
    >
      {loading ? (
        <LoadingState
          fullWidth
          label={t("player.lyrics.loading")}
          className="py-8"
        />
      ) : error ? (
        <ErrorState
          message={t("player.lyrics.error")}
          onRetry={onRetry}
          retryLabel={t("common.retry")}
          className="py-8"
        />
      ) : synced ? (
        <div
          style={
            fullscreen
              ? { paddingTop: "34vh", paddingBottom: "34vh" }
              : undefined
          }
        >
          <SyncedLyrics lines={synced} onSeek={onSeek} />
        </div>
      ) : lyrics?.plain ? (
        <pre className="whitespace-pre-wrap wrap-anywhere py-8 font-sans text-sm leading-relaxed text-text-muted">
          {lyrics.plain}
        </pre>
      ) : (
        <EmptyState title={t("player.lyrics.empty")} />
      )}
    </PlayerLyricsSurface>
  );
}
