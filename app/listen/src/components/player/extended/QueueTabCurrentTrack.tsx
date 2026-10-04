import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Save } from "@crate/ui/icons";
import { Button } from "@crate/ui/shadcn/button";

import { CrateImage } from "@/components/artwork/CrateImage";
import type { Track } from "@/contexts/PlayerContext";

export function QueueTabCurrentTrack({
  currentTrack,
  currentIndex,
  isPlaying,
  sourceName,
  onSave,
}: {
  currentTrack: Track;
  currentIndex: number;
  isPlaying: boolean;
  sourceName: string;
  onSave: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between px-1">
        <p className="text-xs font-bold uppercase tracking-wider text-text-muted">
          {t("player.queue.nowPlayingFrom", { source: sourceName })}
        </p>
        <Button
          variant="ghost"
          size="xs"
          className="h-auto gap-1 rounded px-1.5 py-0.5 font-normal text-text-muted hover:bg-surface-control hover:text-text-secondary has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3"
          onClick={onSave}
          title={t("player.queue.saveAsPlaylist")}
        >
          <Save size={CRATE_ICON_SIZE.micro} />
          {t("common.save")}
        </Button>
      </div>
      <div className="flex items-center gap-3 rounded-lg bg-surface-control px-2 py-1.5">
        <span className="w-4 shrink-0 text-right text-xs tabular-nums text-accent-action">
          {currentIndex + 1}
        </span>
        {currentTrack.albumCover ? (
          <CrateImage
            src={currentTrack.albumCover}
            alt=""
            loading="lazy"
            className=" size-8 shrink-0 rounded object-cover"
          />
        ) : (
          <div className=" size-8 shrink-0 rounded bg-surface-control-hover" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.75rem] font-medium text-accent-action">
            {currentTrack.title}
          </p>
          <p className="truncate text-xs text-text-muted">
            {currentTrack.artist}
          </p>
        </div>
        {isPlaying ? (
          <div className="flex h-4 shrink-0 items-end gap-0.5">
            {["0ms", "200ms", "400ms"].map((animationDelay) => (
              <div
                key={animationDelay}
                className="equalizer-bar w-[3px] rounded-sm bg-accent-action"
                style={{ animationDelay }}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
