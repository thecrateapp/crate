import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Play, Save } from "@crate/ui/icons";
import {
  AppModal,
  ModalBody,
  ModalFooter,
} from "@crate/ui/primitives/AppModal";
import { HairlineList, HairlineRow } from "@crate/ui/primitives/HairlineList";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Button } from "@crate/ui/shadcn/button";
export interface SetlistTrack {
  title: string;
  frequency: number;
  play_count: number;
  last_played?: string;
}
/** Existing frequency rail is a domain readout; no new instrument or playback authority. */
export function ArtistSetlistView({
  artistName,
  setlist,
  open,
  saving,
  canExport,
  onClose,
  onPlay,
  onExport,
}: {
  artistName: string;
  setlist: SetlistTrack[];
  open: boolean;
  saving: boolean;
  canExport: boolean;
  onClose: () => void;
  onPlay: () => void;
  onExport: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AppModal
      open={open}
      onClose={onClose}
      title={t("artist.setlist.title")}
      description={`${artistName} · ${t("artist.setlist.songCount", { count: setlist.length })}`}
      closeLabel={t("common.close")}
      size="md"
      mobileSafeArea
      panelClassName="flex min-h-0 flex-col sm:max-h-[92vh]"
    >
      <ModalBody className="min-h-0 flex-1 p-4">
        <HairlineList label={t("artist.setlist.title")} ruled={false}>
          {setlist.map((track, index) => (
            <HairlineRow
              key={[index, track.title, track.last_played].join(":")}
              index={index + 1}
              truncate={false}
            >
              <span className="block">{track.title}</span>
              <span className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  aria-hidden="true"
                  className="relative h-px w-16 overflow-hidden bg-accent-action/15"
                >
                  <span
                    className="absolute inset-y-0 left-0 bg-accent-action/70"
                    style={{ width: `${Math.round(track.frequency * 100)}%` }}
                  />
                </span>
                <MonoLabel as="span" className="w-[6ch] text-right">
                  {Math.round(track.frequency * 100)}%
                </MonoLabel>
                {track.play_count > 0 ? (
                  <MonoLabel as="span">
                    {t("common.playCount", { count: track.play_count })}
                  </MonoLabel>
                ) : null}
              </span>
            </HairlineRow>
          ))}
        </HairlineList>
      </ModalBody>
      <ModalFooter>
        <Button onClick={onPlay}>
          <Play size={CRATE_ICON_SIZE.xs} fill="currentColor" />
          {t("artist.setlist.play")}
        </Button>
        <Button
          variant="outline"
          onClick={onExport}
          loading={saving}
          disabled={!canExport}
        >
          {!saving ? <Save size={CRATE_ICON_SIZE.xs} /> : null}
          {saving ? t("common.saving") : t("artist.setlist.export")}
        </Button>
      </ModalFooter>
    </AppModal>
  );
}
