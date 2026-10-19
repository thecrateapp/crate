import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Loader2 } from "@crate/ui/icons";

import { usePlayerActions } from "@/contexts/PlayerContext";

import { SyncedLyrics } from "../SyncedLyrics";
import { PlayerLyricsSurface } from "../PlayerLyricsSurface";
import { useLyrics } from "./use-lyrics";

export function LyricsTab({ useAlbumPalette }: { useAlbumPalette: boolean }) {
  void useAlbumPalette;
  const { t } = useTranslation();
  const { currentTrack, seek } = usePlayerActions();
  const { lyrics, loading } = useLyrics(currentTrack);
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2
          size={CRATE_ICON_SIZE.lg}
          className="animate-spin text-accent-action"
        />
      </div>
    );
  }

  if (!lyrics?.synced && !lyrics?.plain) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-text-faint">
        {t("player.lyrics.empty")}
      </div>
    );
  }

  return (
    <PlayerLyricsSurface masked className="pr-1">
      {lyrics.synced ? (
        <div
          className="space-y-1 px-1"
          style={{ paddingTop: "34vh", paddingBottom: "34vh" }}
        >
          <SyncedLyrics lines={lyrics.synced} onSeek={seek} />
        </div>
      ) : null}

      {!lyrics.synced && lyrics.plain ? (
        <pre className="whitespace-pre-wrap py-2 font-sans text-[0.875rem] leading-relaxed text-text-muted">
          {lyrics.plain}
        </pre>
      ) : null}
    </PlayerLyricsSurface>
  );
}
