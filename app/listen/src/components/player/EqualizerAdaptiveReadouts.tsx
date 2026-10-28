import { Activity, Tag } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";
import { getAdaptiveFeatureChipData } from "./equalizer-adaptive-feature-data";
import type { EqFeatures, TrackGenre } from "../../lib/equalizer-types";
import { EqualizerInformationBand } from "./EqualizerInformationBand";

const FEATURE_LABELS: Record<string, string> = {
  brightness: "stats.soundProfile.brightness",
  loudness: "player.info.metric.loudness",
  dynamic: "player.info.metric.dynamicRange",
  energy: "player.info.metric.energy",
};
export function AdaptiveFeatureChips({
  features,
  status,
  enabled = true,
}: {
  features: EqFeatures | null;
  status: "idle" | "loading" | "ready" | "unavailable";
  enabled?: boolean;
}) {
  const { t } = useTranslation();
  const chips =
    status === "ready" && features ? getAdaptiveFeatureChipData(features) : [];
  return (
    <EqualizerInformationBand
      icon={Activity}
      source={chips.length ? "audio_analysis_preset" : undefined}
      current={enabled && chips.length > 0}
    >
      {chips.length ? (
        <>
          {chips.map((chip, index) => (
            <span key={chip.key}>
              {index > 0 ? " · " : null}
              <span>
                {t(FEATURE_LABELS[chip.key]!)} <span>{chip.value}</span>
              </span>
            </span>
          ))}
        </>
      ) : (
        t(
          status === "loading"
            ? "player.equalizer.adaptive.loading"
            : status === "ready" && features
              ? "player.equalizer.adaptive.empty"
              : "player.equalizer.adaptive.unavailable",
        )
      )}
    </EqualizerInformationBand>
  );
}

export function GenreResolutionChip({
  genre,
  status,
  enabled = true,
}: {
  genre: TrackGenre | null;
  status: "idle" | "loading" | "ready" | "unavailable";
  enabled?: boolean;
}) {
  const { t } = useTranslation();
  const ready = status === "ready" && !!genre?.primary;
  const preset = ready ? genre.preset : null;
  const usable = preset?.gains.length === 10;
  return (
    <EqualizerInformationBand
      icon={Tag}
      source={usable ? "genre_taxonomy_preset" : undefined}
      current={enabled && usable}
      label={usable ? t("player.equalizer.sources.genreTaxonomy") : undefined}
      title={
        usable && preset?.inheritedFrom
          ? t("player.equalizer.genre.from", {
              name: preset.inheritedFrom.name,
            })
          : undefined
      }
    >
      {ready ? (
        <>
          <span>{genre.primary!.name}</span>
          {!usable
            ? ` ${t(
                !genre.primary!.canonical
                  ? "player.equalizer.genre.unmapped"
                  : "player.equalizer.genre.noPreset",
              )}`
            : null}
        </>
      ) : (
        t(
          status === "loading"
            ? "player.equalizer.genre.loading"
            : "player.equalizer.genre.unavailable",
        )
      )}
    </EqualizerInformationBand>
  );
}
