import { useTranslation } from "react-i18next";
import { MediaRail, SectionHeader } from "@crate/ui/domain/lists";
import { LoadingState } from "@crate/ui/domain/states";

import { RadioStationCard } from "@/components/radio/RadioStationCard";

import type { PersonalizedRadioStation } from "./radio-model";

export function RadioStationRail({
  title,
  subtitle,
  stations,
  loading,
  disabled,
  onStart,
}: {
  title: string;
  subtitle: string;
  stations: PersonalizedRadioStation[];
  loading: boolean;
  disabled: boolean;
  onStart: (station: PersonalizedRadioStation) => void;
}) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <section className="space-y-4">
        <SectionHeader title={title} subtitle={subtitle} />
        <LoadingState label={t("common.loadingShort")} className="py-10" />
      </section>
    );
  }

  if (!stations.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader title={title} subtitle={subtitle} />
      <MediaRail fit="columns">
        {stations.map((station) => (
          <RadioStationCard
            key={`${station.seed_type}-${station.seed_value}`}
            station={station}
            disabled={disabled}
            showPlayCount
            onPlay={() => onStart(station)}
          />
        ))}
      </MediaRail>
    </section>
  );
}
