import { useMemo } from "react";
import type { TFunction } from "i18next";

import { FullscreenPlayerArtwork } from "@/components/player/FullscreenPlayerArtwork";
import { FullscreenPlayerControls } from "@/components/player/FullscreenPlayerControls";
import { PlayerProgressLeaf } from "./bar/PlayerProgressLeaf";
import { PlayerLyricsContent } from "./PlayerLyricsContent";
import { PlayerStage } from "./PlayerStage";
import { PlayerTrackIdentity } from "@/components/player/PlayerTrackIdentity";
import { PlayerMixIndicator } from "./PlayerMixIndicator";
import type {
  FullscreenPlayerViewProps,
  ViewPlayer,
  ViewRefs,
} from "@/components/player/fullscreen-player-view-types";
import type { FullscreenLyrics } from "@/components/player/fullscreen-player-types";
import { InfoTab } from "@/components/player/extended/InfoTab";
import { QueueTrackRow } from "@/components/player/QueueTrackRow";

function withStableDuplicateKeys<T>(
  items: T[],
  getIdentity: (item: T) => string,
): Array<{ item: T; key: string }> {
  const occurrences = new Map<string, number>();

  return items.map((item) => {
    const identity = getIdentity(item);
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return { item, key: `${identity}-${occurrence}` };
  });
}

export function FullscreenPlayerPlayerTab({
  state,
  player,
  refs,
  actions,
  t,
  playerTabBottomClearance,
  markArtistPhotoFailed,
}: Pick<
  FullscreenPlayerViewProps,
  "state" | "player" | "refs" | "actions" | "t" | "playerTabBottomClearance"
> & {
  markArtistPhotoFailed: () => void;
}) {
  return (
    <PlayerStage
      bottomClearance={playerTabBottomClearance}
      artwork={
        <FullscreenPlayerArtwork
          state={state}
          player={player}
          refs={refs}
          actions={actions}
        />
      }
    >
      <PlayerTrackIdentity
        currentTrack={player.currentTrack}
        crossfadeTransition={player.crossfadeTransition}
        crossfadeProgress={player.crossfadeProgress}
        sourceLabel={player.sourceLabel}
        artistAvatarUrl={player.artistAvatarUrl}
        onArtistAvatarError={markArtistPhotoFailed}
        onArtistClick={actions.goToArtist}
        artistClickable={Boolean(
          player.resolvedArtist?.id != null ||
          player.resolvedArtist?.globalArtistUid,
        )}
      />
      <div className="mx-auto mt-4 w-full max-w-[360px]">
        <PlayerMixIndicator mix={player.mix ?? null} />
        <PlayerProgressLeaf
          onSeek={actions.seekWithFeedback}
          disabled={state.jamQueueLocked}
          remaining
          showTimes
        />
      </div>
      <FullscreenPlayerControls
        state={state}
        player={player}
        actions={actions}
        t={t}
      />
    </PlayerStage>
  );
}

export function FullscreenPlayerQueueTab({
  player,
  t,
  jumpTo,
  locked,
  scrollTabBottomClearance,
}: {
  player: ViewPlayer;
  t: TFunction;
  jumpTo: (index: number) => void;
  locked: boolean;
  scrollTabBottomClearance: string;
}) {
  const keyedTracks = useMemo(
    () =>
      withStableDuplicateKeys(
        player.upcomingTracks,
        (track) => track.globalTrackUid ?? track.entityUid ?? track.id,
      ),
    [player.upcomingTracks],
  );

  return (
    <div
      className="flex-1 overflow-y-auto"
      style={{ paddingBottom: scrollTabBottomClearance }}
    >
      <div className="px-4 py-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-text-muted">
          {t("player.queue.nextUp", {
            count: player.upcomingTracks.length,
          })}
        </p>
        {player.upcomingTracks.length === 0 && (
          <p className="py-2 text-sm text-text-faint">
            {t("player.queue.nothingQueued")}
          </p>
        )}
        {keyedTracks.map(({ item: track, key }, index) => (
          <QueueTrackRow
            key={key}
            track={track}
            queueIndex={index}
            onJump={jumpTo}
            locked={locked}
            haptic
          />
        ))}
      </div>
    </div>
  );
}

export function FullscreenPlayerLyricsTab({
  lyrics,
  lyricsLoading,
  lyricsError,
  onRetryLyrics,
  seek,
  scrollTabBottomClearance,
}: {
  activeLyricIndex: number;
  lyrics: FullscreenLyrics | null;
  lyricsLoading?: boolean;
  lyricsError?: boolean;
  onRetryLyrics?: () => void;
  refs: ViewRefs;
  seek: (time: number) => void;
  t: TFunction;
  scrollTabBottomClearance: string;
}) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col px-5 py-4"
      style={{ paddingBottom: scrollTabBottomClearance }}
    >
      <PlayerLyricsContent
        lyrics={lyrics}
        loading={lyricsLoading ?? !lyrics}
        error={lyricsError}
        onRetry={onRetryLyrics}
        presentation="fullscreen"
        onSeek={seek}
      />
    </div>
  );
}

export function FullscreenPlayerInfoTab({
  scrollTabBottomClearance,
}: {
  scrollTabBottomClearance: string;
}) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3"
      style={{ paddingBottom: scrollTabBottomClearance }}
    >
      <InfoTab className="pr-0" />
    </div>
  );
}
