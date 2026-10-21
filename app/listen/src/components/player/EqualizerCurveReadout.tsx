import { useTranslation } from "react-i18next";
import { SlidersHorizontal } from "@crate/ui/icons";
import type { EqCurve, EqDataStatus } from "../../lib/equalizer-types";
import { EQ_PRESET_LABEL_KEYS } from "../../lib/equalizer-labels";
import type { EqualizerPanelState } from "./equalizer-panel-state";
import { EqualizerSmartReadout } from "./EqualizerSmartReadout";
import { EqualizerInformationBand } from "./EqualizerInformationBand";
import {
  AdaptiveFeatureChips,
  GenreResolutionChip,
} from "./EqualizerAdaptiveReadouts";

/** One information slot for the mode actually driving the instrument. */
export function EqualizerCurveReadout({
  eq,
  curves,
  curvesStatus,
}: {
  eq: EqualizerPanelState;
  curves?: EqCurve[] | null;
  curvesStatus: EqDataStatus;
}) {
  const { t } = useTranslation();
  if (eq.smart)
    return (
      <EqualizerSmartReadout
        eq={eq.effectiveEq}
        status={eq.smartStatus === "idle" ? curvesStatus : eq.smartStatus}
        curves={curves}
        activeSource={eq.enabled ? eq.effectiveEq?.source : null}
      />
    );
  if (eq.genreAdaptive)
    return (
      <GenreResolutionChip
        genre={eq.trackGenre}
        status={eq.genreAdaptiveStatus}
        enabled={eq.enabled}
      />
    );
  if (eq.adaptive)
    return (
      <AdaptiveFeatureChips
        features={eq.adaptiveFeatures}
        status={eq.adaptiveStatus}
        enabled={eq.enabled}
      />
    );
  return (
    <EqualizerInformationBand
      icon={SlidersHorizontal}
      source={eq.preset === "flat" ? "flat" : undefined}
      current={eq.enabled && eq.preset === "flat"}
      label={t("player.equalizer.preset")}
    >
      {t(EQ_PRESET_LABEL_KEYS[eq.preset] ?? "player.equalizer.custom")}
    </EqualizerInformationBand>
  );
}
