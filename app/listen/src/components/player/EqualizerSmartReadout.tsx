import { useTranslation } from "react-i18next";
import type {
  EffectiveEq,
  EqCurve,
  EqSource,
  EqDataStatus,
} from "../../lib/equalizer-types";
import { SMART_EQ_SOURCE_LABEL_KEYS } from "../../lib/equalizer-labels";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { FormField } from "@crate/ui/primitives/FormField";

interface EqualizerSmartReadoutProps {
  eq: EffectiveEq | null;
  status: EqDataStatus;
  curves?: EqCurve[] | null;
  activeSource?: EqSource | null;
}
/** Availability is data, not a new source-selection command or a guessed chain. */
export function EqualizerSmartReadout({
  eq,
  status,
  curves,
  activeSource,
}: EqualizerSmartReadoutProps) {
  const { t } = useTranslation();
  const available = (curves ?? (eq ? [eq] : [])).filter((curve) =>
    Object.prototype.hasOwnProperty.call(
      SMART_EQ_SOURCE_LABEL_KEYS,
      curve.source,
    ),
  );
  const active = activeSource === undefined ? eq?.source : activeSource;
  const detail =
    eq?.source === "genre_taxonomy_preset" && eq.genre
      ? eq.inheritedFrom
        ? t("player.equalizer.genre.from", { name: eq.inheritedFrom.name })
        : eq.genre.name
      : eq?.reasoning || eq?.label;
  return (
    <FormField kind="group" label={t("player.equalizer.trackCurves")}>
      {(control) => (
        <div {...control} role="group" className="grid gap-2">
          {available.length ? (
            <div role="list" className="flex min-w-0 flex-wrap gap-2">
              {available.map((curve) => (
                <InfoBadge
                  key={curve.source}
                  role="listitem"
                  data-source={curve.source}
                  aria-current={active === curve.source ? "true" : undefined}
                  active={active === curve.source}
                  title={
                    curve.label || t(SMART_EQ_SOURCE_LABEL_KEYS[curve.source])
                  }
                >
                  {t(SMART_EQ_SOURCE_LABEL_KEYS[curve.source])}
                </InfoBadge>
              ))}
            </div>
          ) : (
            <MonoLabel>
              {t(
                status === "loading"
                  ? "player.equalizer.smart.resolving"
                  : "player.equalizer.smart.waiting",
              )}
            </MonoLabel>
          )}
          {curves == null && available.length > 0 ? (
            <p className="m-0 text-xs text-text-muted">
              {t("player.equalizer.currentCurveOnly")}
            </p>
          ) : null}
          {detail ? (
            <p className="m-0 text-xs leading-relaxed text-text-muted">
              {detail}
            </p>
          ) : null}
        </div>
      )}
    </FormField>
  );
}
