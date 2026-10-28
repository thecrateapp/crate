import { useTranslation } from "react-i18next";
import { Activity, Brain, Tag } from "@crate/ui/icons";
import type {
  EffectiveEq,
  EqCurve,
  EqSource,
  EqDataStatus,
} from "../../lib/equalizer-types";
import { SMART_EQ_SOURCE_LABEL_KEYS } from "../../lib/equalizer-labels";
import { EqualizerInformationBand } from "./EqualizerInformationBand";

interface EqualizerSmartReadoutProps {
  eq: EffectiveEq | null;
  status: EqDataStatus;
  curves?: EqCurve[] | null;
  activeSource?: EqSource | null;
}
/** Reports the applied source; availability never implies that a curve is playing. */
export function EqualizerSmartReadout({
  eq,
  status,
  activeSource,
}: EqualizerSmartReadoutProps) {
  const { t } = useTranslation();
  const source = eq?.source;
  const sourceLabel = source ? t(SMART_EQ_SOURCE_LABEL_KEYS[source]) : null;
  const detail =
    eq?.genre?.name || (eq?.label !== sourceLabel ? eq?.label : null);
  return (
    <EqualizerInformationBand
      icon={
        source === "genre_taxonomy_preset"
          ? Tag
          : source === "audio_analysis_preset"
            ? Activity
            : Brain
      }
      source={source}
      current={
        !!source && (activeSource === undefined || activeSource === source)
      }
      title={
        eq
          ? [
              eq.label,
              eq.reasoning,
              eq.inheritedFrom
                ? t("player.equalizer.genre.from", {
                    name: eq.inheritedFrom.name,
                  })
                : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : undefined
      }
      label={eq && detail ? (sourceLabel ?? undefined) : undefined}
    >
      {eq ? (
        <>{detail ? <span>{detail}</span> : sourceLabel}</>
      ) : (
        t(
          status === "loading"
            ? "player.equalizer.smart.resolving"
            : "player.equalizer.smart.waiting",
        )
      )}
    </EqualizerInformationBand>
  );
}
