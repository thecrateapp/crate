import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Loader2, Star } from "@crate/ui/icons";
import { notify } from "@crate/ui/lib/notify";
import { Button } from "@crate/ui/shadcn/button";

import { usePlayerActions } from "@/contexts/PlayerContext";
import {
  hasPlayableTrackReference,
  toPlayableTrack,
} from "@/lib/playable-track";
import { fetchTrackRadio } from "@/lib/radio";

import { SuggestedTrackRow } from "./SuggestedTrackRow";
import { useSuggestedTracks } from "./use-suggested-tracks";

export function SuggestedTab() {
  const { t } = useTranslation();
  const { currentTrack, play, playAll } = usePlayerActions();
  const { tracks, loading } = useSuggestedTracks(currentTrack);
  const [startingRadio, setStartingRadio] = useState(false);

  const handlePlay = useCallback(
    (track: (typeof tracks)[number]) => {
      if (!currentTrack) return;
      play(
        toPlayableTrack({
          ...track,
          id: track.track_id ?? track.path,
          library_track_id: track.track_id,
        }),
        {
          type: "radio",
          name: t("player.suggested.playSource", {
            title: currentTrack.title,
          }),
        },
      );
    },
    [currentTrack, play, t],
  );

  async function handleStartTrackRadio() {
    if (!currentTrack) return;
    try {
      setStartingRadio(true);
      const radio = await fetchTrackRadio({
        libraryTrackId: currentTrack.libraryTrackId ?? null,
        entityUid: currentTrack.entityUid ?? null,
        path: currentTrack.path ?? null,
        title: currentTrack.title,
      });
      if (!radio.tracks.length) {
        notify.info(t("actions.track.toasts.radioUnavailable"));
        return;
      }
      playAll(radio.tracks, 0, radio.source);
    } catch {
      notify.error(t("actions.track.toasts.radioFailed"));
    } finally {
      setStartingRadio(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 size={20} className="animate-spin text-accent-action" />
      </div>
    );
  }

  if (tracks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-text-primary/20">
        {t("player.suggested.empty")}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto pr-1">
      <div className="mb-3 px-1">
        <Button
          variant="ghost"
          shape="pill"
          onClick={handleStartTrackRadio}
          disabled={
            startingRadio ||
            !currentTrack ||
            !hasPlayableTrackReference(currentTrack)
          }
          className="h-auto border border-border-quiet bg-text-primary/5 px-3 py-1.5 text-xs text-text-primary/80 hover:bg-text-primary/10 hover:text-text-primary/80 has-[>svg]:px-3 [&_svg:not([class*='size-'])]:size-3"
        >
          {startingRadio ? (
            <Loader2 size={CRATE_ICON_SIZE.micro} className="animate-spin" />
          ) : (
            <Star size={CRATE_ICON_SIZE.micro} />
          )}
          {t("actions.track.radio")}
        </Button>
      </div>
      {tracks.map((track, index) => (
        <SuggestedTrackRow
          key={track.track_entity_uid ?? track.track_id ?? track.path}
          track={track}
          index={index}
          onPlay={handlePlay}
        />
      ))}
    </div>
  );
}
