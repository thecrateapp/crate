import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { notify } from "@crate/ui/lib/notify";

import { usePlayerActions } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";
import { fetchPlayableSetlist } from "@/lib/upcoming";

import type { UpcomingItem } from "./upcoming-model";

export function useUpcomingShowActions(
  item: UpcomingItem,
  onAttendanceChange?: (attending: boolean) => void,
) {
  const { t } = useTranslation();
  const { playAll } = usePlayerActions();
  const [attending, setAttending] = useState(Boolean(item.user_attending));
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [playingSetlist, setPlayingSetlist] = useState(false);

  useEffect(() => {
    setAttending(Boolean(item.user_attending));
  }, [item.user_attending]);

  async function toggleAttendance() {
    if (!item.id) return;
    setSavingAttendance(true);
    try {
      if (attending) {
        await api(`/api/me/shows/${item.id}/attendance`, "DELETE");
        setAttending(false);
        onAttendanceChange?.(false);
        notify.success(t("radar.show.toasts.removedAttendance"));
      } else {
        await api(`/api/me/shows/${item.id}/attendance`, "POST");
        setAttending(true);
        onAttendanceChange?.(true);
        notify.success(t("radar.show.toasts.markedAttending"));
      }
    } catch {
      notify.error(t("radar.show.toasts.attendanceFailed"));
    } finally {
      setSavingAttendance(false);
    }
  }

  async function playProbableSetlist() {
    if (!item.probable_setlist?.length) {
      notify.info(t("radar.show.toasts.noSetlist"));
      return;
    }
    if (!item.artist_id) {
      notify.info(t("radar.show.toasts.artistNotLinked"));
      return;
    }
    try {
      setPlayingSetlist(true);
      const queue = await fetchPlayableSetlist({
        artistId: item.artist_id,
        artistName: item.artist,
      });
      if (!queue.length) {
        notify.info(
          t("radar.show.toasts.setlistTracksMissing", {
            count: item.probable_setlist.length,
          }),
        );
        return;
      }
      playAll(queue, 0, {
        type: "playlist",
        name: t("radar.show.probableSetlistSource", { name: item.artist }),
      });
      notify.success(
        t("radar.show.toasts.playingSetlist", { count: queue.length }),
      );
    } catch {
      notify.error(t("radar.show.toasts.loadSetlistFailed"));
    } finally {
      setPlayingSetlist(false);
    }
  }

  return {
    attending,
    savingAttendance,
    playingSetlist,
    toggleAttendance,
    playProbableSetlist,
  };
}
