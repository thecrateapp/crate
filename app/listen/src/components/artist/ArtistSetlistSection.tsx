import { useState } from "react";
import { useTranslation } from "react-i18next";
import { notify } from "@crate/ui/lib/notify";

import { ArtistSetlistView, type SetlistTrack } from "./ArtistSetlistView";
import { api } from "@/lib/api";

interface ArtistSetlistModalProps {
  artistName: string;
  artistId?: number;
  setlist: SetlistTrack[];
  open: boolean;
  onClose: () => void;
  onPlay: () => void;
}

export function ArtistSetlistModal({
  artistName,
  artistId,
  setlist,
  open,
  onClose,
  onPlay,
}: ArtistSetlistModalProps) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  async function handleExport() {
    if (!artistId) return;
    setSaving(true);
    try {
      await api(`/api/artists/${artistId}/setlist-playlist`, "POST");
      notify.success(t("artist.setlist.toasts.exported"));
    } catch {
      notify.error(t("artist.setlist.toasts.exportFailed"));
    } finally {
      setSaving(false);
    }
  }

  function handlePlay() {
    onPlay();
    onClose();
  }

  return (
    <ArtistSetlistView
      artistName={artistName}
      setlist={setlist}
      open={open}
      saving={saving}
      canExport={!!artistId}
      onClose={onClose}
      onPlay={handlePlay}
      onExport={() => void handleExport()}
    />
  );
}
