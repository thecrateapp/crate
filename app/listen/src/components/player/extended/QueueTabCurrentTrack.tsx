import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Save } from "@crate/ui/icons";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import type { Track } from "@/contexts/player-types";
import { QueueTrackRow } from "../QueueTrackRow";
export function QueueTabCurrentTrack({
  currentTrack,
  currentIndex,
  onSave,
  onJump,
  locked,
}: {
  currentTrack: Track;
  currentIndex: number;
  onSave: () => void;
  onJump: (index: number) => void;
  locked: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between px-1">
        <MonoLabel as="p">{t("player.queue.nowPlaying")}</MonoLabel>
        <ActionButton
          onClick={onSave}
          label={t("player.queue.saveAsPlaylist")}
          tooltip={t("common.save")}
        >
          <Save size={CRATE_ICON_SIZE.lg} />
        </ActionButton>
      </div>
      <QueueTrackRow
        track={currentTrack}
        queueIndex={currentIndex}
        onJump={onJump}
        locked={locked}
        isCurrent
      />
    </div>
  );
}
