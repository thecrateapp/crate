import { CRATE_ICON_SIZE, X, Loader2 } from "@crate/ui/icons";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { useTranslation } from "react-i18next";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { useLyrics } from "./extended/use-lyrics";
import { SyncedLyrics } from "./SyncedLyrics";
export function LyricsPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { currentTrack, seek } = usePlayerActions();
  const { lyrics, loading } = useLyrics(open ? currentTrack : null);
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
      <div className="relative flex-1 overflow-y-auto px-4">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2
              size={CRATE_ICON_SIZE.lg}
              className="animate-spin text-accent-action"
            />
          </div>
        ) : lyrics?.synced?.length ? (
          <SyncedLyrics lines={lyrics.synced} onSeek={seek} />
        ) : lyrics?.plain ? (
          <pre className="whitespace-pre-wrap py-8 font-sans text-sm leading-relaxed text-text-muted">
            {lyrics.plain}
          </pre>
        ) : (
          <p className="py-16 text-center text-sm text-text-faint">
            {t("player.lyrics.empty")}
          </p>
        )}
      </div>
    </div>
  );
}
