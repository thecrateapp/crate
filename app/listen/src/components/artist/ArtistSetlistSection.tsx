import { CRATE_ICON_SIZE, ListMusic, Play, Save } from "@crate/ui/icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { notify } from "@crate/ui/lib/notify";

import { AppModal } from "@crate/ui/primitives/AppModal";
import { Button } from "@crate/ui/shadcn/button";
import { api } from "@/lib/api";

interface SetlistTrack {
  title: string;
  frequency: number;
  play_count: number;
  last_played?: string;
}

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
    <AppModal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <ListMusic
            size={CRATE_ICON_SIZE.md}
            className="shrink-0 text-accent-action"
          />
          {t("artist.setlist.title")}
        </span>
      }
      description={`${artistName} · ${t("artist.setlist.songCount", {
        count: setlist.length,
      })}`}
      closeLabel={t("common.close")}
      headerClassName="border-text-primary/5 bg-transparent"
      maxWidthClassName="max-w-md"
      mobileSafeArea
      overlayClassName="bg-surface-canvas/58"
      panelClassName="listen-glass-panel flex min-h-0 flex-col overflow-hidden border-0 pb-4 sm:max-h-[92vh]"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto p-2 ">
          {setlist.map((track, i) => (
            <div
              key={[
                track.title,
                track.last_played ?? "",
                track.frequency,
                track.play_count,
              ].join(":")}
              className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-text-primary/[0.03]"
            >
              <span className="w-5 shrink-0 text-right text-xs tabular-nums text-text-primary/20">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm text-text-primary">
                  {track.title}
                </span>
                <div className="mt-1 flex items-center gap-2">
                  <div className="relative h-1 w-16 rounded-full bg-accent-action/15">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-accent-action/70"
                      style={{ width: `${Math.round(track.frequency * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs tabular-nums text-text-primary/40">
                    {Math.round(track.frequency * 100)}%
                  </span>
                  {track.play_count > 0 && (
                    <span className="text-xs text-text-primary/20">
                      {t("common.playCount", { count: track.play_count })}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2 border-t border-text-primary/5 px-5 py-4">
          <Button
            variant="secondary"
            onClick={handlePlay}
            className="flex-1 rounded-lg bg-accent-action/15 text-accent-action hover:bg-accent-action/25"
          >
            <Play size={CRATE_ICON_SIZE.xs} fill="currentColor" />
            {t("artist.setlist.play")}
          </Button>
          <Button
            variant="outline"
            onClick={() => void handleExport()}
            loading={saving}
            disabled={!artistId}
            className="rounded-lg"
          >
            {saving ? null : <Save size={CRATE_ICON_SIZE.xs} />}
            {saving ? t("common.saving") : t("artist.setlist.export")}
          </Button>
        </div>
      </div>
    </AppModal>
  );
}
