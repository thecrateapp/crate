import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

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
        toast.success(t("radar.show.toasts.removedAttendance"));
      } else {
        await api(`/api/me/shows/${item.id}/attendance`, "POST");
        setAttending(true);
        onAttendanceChange?.(true);
        toast.success(t("radar.show.toasts.markedAttending"));
      }
    } catch {
      toast.error(t("radar.show.toasts.attendanceFailed"));
    } finally {
      setSavingAttendance(false);
    }
  }

  async function playProbableSetlist() {
    if (!item.probable_setlist?.length) {
      toast.info(t("radar.show.toasts.noSetlist"));
      return;
    }
    if (!item.artist_id) {
      toast.info(t("radar.show.toasts.artistNotLinked"));
      return;
    }
    try {
      setPlayingSetlist(true);
      const queue = await fetchPlayableSetlist({
        artistId: item.artist_id,
        artistName: item.artist,
      });
      if (!queue.length) {
        toast.info(
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
      toast.success(
        t("radar.show.toasts.playingSetlist", { count: queue.length }),
      );
    } catch {
      toast.error(t("radar.show.toasts.loadSetlistFailed"));
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
