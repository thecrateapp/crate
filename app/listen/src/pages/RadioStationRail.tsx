import { RadioStationCard } from "@/components/radio/RadioStationCard";
import { RadioStationRailView } from "./RadioStationRailView";
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
  return (
    <RadioStationRailView
      title={title}
      subtitle={subtitle}
      count={stations.length}
      loading={loading}
    >
      {stations.map((station) => (
        <RadioStationCard
          key={`${station.seed_type}-${station.seed_value}`}
          station={station}
          disabled={disabled}
          showPlayCount
          onPlay={() => onStart(station)}
        />
      ))}
    </RadioStationRailView>
  );
}
