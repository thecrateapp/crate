import { CRATE_ICON_SIZE, X } from "@crate/ui/icons";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { useTranslation } from "react-i18next";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { useLyrics } from "./extended/use-lyrics";
import { PlayerLyricsContent } from "./PlayerLyricsContent";
export function LyricsPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { currentTrack, seek } = usePlayerActions();
  const { lyrics, loading, error, retry } = useLyrics(
    open ? currentTrack : null,
  );
  if (!open) return null;
  return (
    <div className="z-app-player-drawer fixed right-0 top-0 bottom-(--listen-desktop-player-clearance) flex w-[480px] max-w-full flex-col overflow-hidden border-l border-border-quiet bg-surface-canvas">
      <div className="flex items-center justify-between border-b border-border-quiet px-4 py-3">
        <MonoLabel as="h2">{t("player.lyrics")}</MonoLabel>
        <ActionButton label={t("player.lyrics.close")} onClick={onClose}>
          <X size={CRATE_ICON_SIZE.lg} />
        </ActionButton>
      </div>
      {currentTrack ? (
        <div className="border-b border-border-quiet px-4 py-3">
          <p className="truncate text-caption font-medium text-text-primary">
            {currentTrack.title}
          </p>
          <p className="truncate font-mono text-xs text-text-muted">
            {currentTrack.artist}
          </p>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 px-4">
        <PlayerLyricsContent
          lyrics={lyrics}
          loading={loading}
          error={error}
          onRetry={retry}
          presentation="drawer"
          onSeek={seek}
        />
      </div>
    </div>
  );
}
