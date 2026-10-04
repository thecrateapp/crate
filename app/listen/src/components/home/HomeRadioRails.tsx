import { useTranslation } from "react-i18next";

import { MediaRail, SectionHeader } from "@crate/ui/domain/lists";
import { RadioStationCard } from "@/components/radio/RadioStationCard";

import type { HomeRadioStation, HomeSectionId } from "./home-model";

export { RadioStationCard };

export function RadioStationsSection({
  stations,
  onPlayStation,
  onViewAll,
}: {
  stations: HomeRadioStation[];
  onPlayStation: (station: HomeRadioStation) => void;
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const { t } = useTranslation();
  if (!stations.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.radioStations.title")}
        subtitle={t("home.sections.radioStations.subtitle")}
        actionLabel={t("common.viewAll")}
        onAction={() => onViewAll("radio-stations")}
      />
      <MediaRail fit="columns">
        {stations.map((station) => (
          <RadioStationCard
            key={`${station.type}-${
              station.seed_value ??
              station.global_artist_uid ??
              station.global_album_uid ??
              station.artist_id ??
              station.album_id ??
              station.title
            }`}
            station={station}
            onPlay={() => onPlayStation(station)}
          />
        ))}
      </MediaRail>
    </section>
  );
}
