import { useTranslation } from "react-i18next";

import {
  MediaCover,
  type MediaCoverProps,
} from "@crate/ui/domain/media/MediaCover";
import { CRATE_ICON_SIZE, Play, Shuffle } from "@crate/ui/icons";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Button } from "@crate/ui/shadcn/button";
import { Card } from "@crate/ui/shadcn/card";

import { formatStatsMinutes } from "./stats-format";
import { localizedReplayTitle } from "./stats-model";
import type { ReplayMix, StatsTrack } from "./stats-types";

const MOSAIC_SIZE = 4;

export interface StatsReplayCardProps {
  replay: ReplayMix;
  onPlay: () => void;
  onShuffle: () => void;
  /** Cover for a replay track; the adapter owns library routes. Null shows the fallback. */
  coverUrl?: (track: StatsTrack) => string | null;
  /** Managed image transport supplied by the adapter. */
  renderImage?: MediaCoverProps["renderImage"];
}

/** The replay mix as a playable card: cover mosaic, title, size and Play/Shuffle. */
export function StatsReplayCard({
  replay,
  onPlay,
  onShuffle,
  coverUrl,
  renderImage,
}: StatsReplayCardProps) {
  const { t } = useTranslation();
  const title = localizedReplayTitle(replay, t) || t("stats.replay.title");
  const covers = replay.items.slice(0, MOSAIC_SIZE);
  return (
    <Card
      as="section"
      aria-label={title}
      className="flex-row items-center gap-4 p-4"
    >
      <div
        aria-hidden="true"
        className="grid size-24 shrink-0 grid-cols-2 gap-0.5 overflow-hidden rounded-md"
      >
        {Array.from({ length: MOSAIC_SIZE }, (_, index) => {
          const item = covers[index];
          return (
            <MediaCover
              key={item ? `${item.track_id ?? item.title}-${index}` : index}
              src={item && coverUrl ? coverUrl(item) : null}
              alt=""
              className="size-full"
              renderImage={renderImage}
            />
          );
        })}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="min-w-0">
          <MonoLabel tone="accent">
            {t("stats.replay.card.meta", {
              count: replay.track_count,
              duration: formatStatsMinutes(replay.minutes_listened),
            })}
          </MonoLabel>
          <div className="mt-1 truncate font-bold text-text-primary">
            {title}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={onPlay}>
            <Play size={CRATE_ICON_SIZE.sm} />
            {t("player.play")}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onShuffle}>
            <Shuffle size={CRATE_ICON_SIZE.sm} />
            {t("player.shuffle")}
          </Button>
        </div>
      </div>
    </Card>
  );
}
