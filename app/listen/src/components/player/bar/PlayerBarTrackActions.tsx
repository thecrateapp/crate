import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE } from "@crate/ui/icons";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";

import { RadioFeedback } from "@/components/player/RadioFeedback";
import type { Track } from "@/contexts/player-types";

interface PlayerBarTrackActionsProps {
  displayTrack: Track;
  isShapedRadioTrack: boolean;
  liked: boolean;
  likeStateAvailable?: boolean;
  onNextTrack: () => void;
  onToggleLike: () => void;
  shapedRadioSessionId: string | null | undefined;
}

export function PlayerBarTrackActions({
  displayTrack,
  isShapedRadioTrack,
  liked,
  likeStateAvailable = true,
  onNextTrack,
  onToggleLike,
  shapedRadioSessionId,
}: PlayerBarTrackActionsProps) {
  const { t } = useTranslation();

  return (
    <div className="ml-1 flex shrink-0 items-center gap-0.5">
      <FollowHeartButton
        following={liked}
        disabled={!likeStateAvailable}
        label={t(
          likeStateAvailable
            ? "actions.track.like"
            : "library.liked.stateUnavailable",
        )}
        labelActive={t(
          likeStateAvailable
            ? "actions.track.unlike"
            : "library.liked.stateUnavailable",
        )}
        title={t(
          likeStateAvailable
            ? liked
              ? "actions.track.unlike"
              : "actions.track.like"
            : "library.liked.stateUnavailable",
        )}
        heartTestId="player-bar-like-heart"
        particlesTestId="player-bar-like-particles"
        iconSize={CRATE_ICON_SIZE.md}
        className="size-7.5 shrink-0 rounded-full hover:-translate-y-px after:absolute after:top-1/2 after:left-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2"
        onClick={(event) => {
          event.stopPropagation();
          onToggleLike();
        }}
      />

      {isShapedRadioTrack && shapedRadioSessionId ? (
        <RadioFeedback
          sessionId={shapedRadioSessionId}
          trackId={displayTrack.libraryTrackId}
          globalTrackUid={displayTrack.globalTrackUid}
          onDislike={onNextTrack}
        />
      ) : null}
    </div>
  );
}
