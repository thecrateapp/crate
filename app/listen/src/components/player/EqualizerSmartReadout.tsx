import { Fragment } from "react";
import { useTranslation } from "react-i18next";

import type { EffectiveEq } from "@/hooks/use-effective-eq";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

interface EqualizerSmartReadoutProps {
  eq: EffectiveEq | null;
  status: "idle" | "loading" | "ready" | "unavailable";
}

export function EqualizerSmartReadout({
  eq,
  status,
}: EqualizerSmartReadoutProps) {
  const { t } = useTranslation();
  if (status === "loading") {
    return (
      <MonoLabel accent={t("player.equalizer.smart.label")}>
        {t("player.equalizer.smart.resolving")}
      </MonoLabel>
    );
  }

  if (status === "unavailable" || !eq) {
    return (
      <p className="text-xs text-text-muted">
        {t("player.equalizer.smart.waiting")}
      </p>
    );
  }

  const detail =
    eq.source === "genre_taxonomy_preset" && eq.genre
      ? eq.inheritedFrom
        ? `Inherited from ${eq.inheritedFrom.name}`
        : eq.genre.name
      : eq.reasoning || eq.label;

  return (
    <div className="space-y-2">
      <MonoLabel>
        <span className="mr-3 text-text-muted">
          {t("player.equalizer.smart.label")}
        </span>
        {SMART_EQ_CHAIN.map((source, index) => (
          <Fragment key={source}>
            {index > 0 ? (
              <span aria-hidden="true" className="px-1.5 opacity-50">
                →
              </span>
            ) : null}
            <span
              data-source={source}
              aria-current={source === eq.source ? "true" : undefined}
              className={
                source === eq.source ? "text-accent-action-hi" : undefined
              }
            >
              {SMART_EQ_SOURCE_LABELS[source]}
            </span>{" "}
          </Fragment>
        ))}
      </MonoLabel>
      {detail ? (
        <p className="line-clamp-2 text-xs leading-relaxed text-text-muted">
          {detail}
        </p>
      ) : null}
    </div>
  );
}

const SMART_EQ_CHAIN: readonly EffectiveEq["source"][] = [
  "user_track_preset",
  "instance_track_preset",
  "instance_album_preset",
  "genre_taxonomy_preset",
  "audio_analysis_preset",
  "flat",
];

const SMART_EQ_SOURCE_LABELS: Record<EffectiveEq["source"], string> = {
  user_track_preset: "User track preset",
  instance_track_preset: "Curator track preset",
  instance_album_preset: "Curator album preset",
  genre_taxonomy_preset: "Genre taxonomy",
  audio_analysis_preset: "Audio analysis",
  flat: "Flat",
};
