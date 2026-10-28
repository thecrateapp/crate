import { useTranslation } from "react-i18next";

import { RadioSeedPanel } from "./RadioSeedPanel";
import { RadioPageView } from "./RadioPageView";
import { RadioStationRail } from "./RadioStationRail";
import { useRadioController } from "./use-radio-controller";

export function RadioPage() {
  const { t } = useTranslation();
  const radio = useRadioController();

  return (
    <RadioPageView
      radio={radio}
      seed={
        <RadioSeedPanel
          query={radio.query}
          searching={radio.searching}
          results={radio.results}
          starting={radio.starting}
          onQueryChange={radio.onQueryChange}
          onStartSeeded={radio.startSeeded}
          error={radio.searchError ? t("search.unavailableTitle") : undefined}
          onRetry={radio.retrySearch}
        />
      }
      artistStations={
        <RadioStationRail
          title={t("radio.artistStations.title")}
          subtitle={t("radio.artistStations.subtitle")}
          stations={radio.artistStations}
          loading={radio.stationsLoading}
          disabled={radio.starting}
          onStart={radio.startStation}
        />
      }
      genreStations={
        <RadioStationRail
          title={t("radio.genreStations.title")}
          subtitle={t("radio.genreStations.subtitle")}
          stations={radio.genreStations}
          loading={radio.stationsLoading}
          disabled={radio.starting}
          onStart={radio.startStation}
        />
      }
    />
  );
}
