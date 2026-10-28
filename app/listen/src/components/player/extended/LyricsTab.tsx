import { usePlayerActions } from "@/contexts/PlayerContext";
import { PlayerLyricsContent } from "../PlayerLyricsContent";
import { useLyrics } from "./use-lyrics";
export function LyricsTab({ useAlbumPalette }: { useAlbumPalette: boolean }) {
  void useAlbumPalette;
  const { currentTrack, seek } = usePlayerActions();
  const { lyrics, loading, error, retry } = useLyrics(currentTrack);
  return (
    <PlayerLyricsContent
      lyrics={lyrics}
      loading={loading}
      error={error}
      onRetry={retry}
      presentation="fullscreen"
      onSeek={seek}
    />
  );
}
