import { useTranslation } from "react-i18next";
import { formatStatsRelativeTime } from "@/components/stats/stats-format";
import { CRATE_ICON_SIZE, Play, Save } from "@crate/ui/icons";
import {
  AppModal,
  ModalBody,
  ModalFooter,
} from "@crate/ui/primitives/AppModal";
import { HairlineList, HairlineRow } from "@crate/ui/primitives/HairlineList";
import { SetlistFrequency } from "@crate/ui/domain/shows/SetlistFrequency";
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
  generatedAt,
  open,
  saving,
  canExport,
  onClose,
  onPlay,
  onExport,
}: {
  artistName: string;
  setlist: SetlistTrack[];
  generatedAt?: string | null;
  open: boolean;
  saving: boolean;
  canExport: boolean;
  onClose: () => void;
  onPlay: () => void;
  onExport: () => void;
}) {
  const { t, i18n } = useTranslation();
  const updated = formatStatsRelativeTime(
    generatedAt,
    Date.now(),
    i18n.language,
  );
  return (
    <AppModal
      open={open}
      onClose={onClose}
      title={t("artist.setlist.title")}
      description={[
        artistName,
        t("artist.setlist.songCount", { count: setlist.length }),
        updated ? t("artist.setlist.updated", { time: updated }) : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      closeLabel={t("common.close")}
      size="md"
      mobileSafeArea
    >
      <ModalBody className="p-4">
        <HairlineList label={t("artist.setlist.title")} ruled={false}>
          {setlist.map((track, index) => (
            <HairlineRow
              key={[index, track.title, track.last_played].join(":")}
              index={index + 1}
              truncate={false}
            >
              <span className="block">{track.title}</span>
              <span className="mt-2 block">
                <SetlistFrequency
                  frequency={track.frequency}
                  label={t("artist.setlist.frequencyLabel", {
                    title: track.title,
                  })}
                  plays={t("common.playCount", { count: track.play_count })}
                />
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
