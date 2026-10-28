import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState } from "@crate/ui/domain/states";
import { RadioHero } from "./RadioHero";
import { RadioSessionStatus } from "./RadioSessionStatus";
import type { RadioMode } from "./radio-types";
export function RadioPageView({
  radio,
  seed,
  artistStations,
  genreStations,
}: {
  radio: {
    starting: boolean;
    discoveryAvailable: boolean;
    startDiscovery: () => void;
    activeSession: string | null;
    activeMode: RadioMode | null;
    seedLabel: string;
    stationsError: string | null;
    retryStations?: () => void;
  };
  seed: ReactNode;
  artistStations: ReactNode;
  genreStations: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="animate-page-in grid min-w-0 gap-7 sm:py-6">
      <RadioHero
        starting={radio.starting}
        discoveryAvailable={radio.discoveryAvailable}
        onStartDiscovery={radio.startDiscovery}
      />
      <RadioSessionStatus
        activeSession={radio.activeSession}
        activeMode={radio.activeMode}
        seedLabel={radio.seedLabel}
      />
      {seed}
      {radio.stationsError && (
        <ErrorState
          message={t("radio.errors.stations")}
          onRetry={radio.retryStations}
          retryLabel={t("common.retry")}
        />
      )}
      {artistStations}
      {genreStations}
    </div>
  );
}
