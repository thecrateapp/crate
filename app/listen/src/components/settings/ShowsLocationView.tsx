import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState, LoadingState } from "@crate/ui/domain/states";
import { Section } from "./SettingsPrimitives";
import {
  FixedCityPicker,
  LocationModePicker,
  RadiusPicker,
} from "./ShowsLocationControls";
export function ShowsLocationView({
  loading,
  error,
  onRetry,
  mode,
  city,
  radius,
}: {
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  mode: ComponentProps<typeof LocationModePicker>;
  city: ComponentProps<typeof FixedCityPicker>;
  radius: ComponentProps<typeof RadiusPicker>;
}) {
  const { t } = useTranslation();
  return (
    <Section
      title={t("settings.shows.title")}
      description={t("settings.shows.description")}
    >
      {loading ? (
        <LoadingState label={t("common.loadingShort")} />
      ) : error ? (
        <ErrorState
          message={t("settings.readError")}
          retryLabel={t("common.retry")}
          onRetry={onRetry}
        />
      ) : (
        <>
          <div className="grid min-w-0 gap-5 @min-[32rem]:grid-cols-2">
            <LocationModePicker {...mode} />
            <RadiusPicker {...radius} />
          </div>
          {mode.mode === "fixed" ? <FixedCityPicker {...city} /> : null}
        </>
      )}
    </Section>
  );
}
