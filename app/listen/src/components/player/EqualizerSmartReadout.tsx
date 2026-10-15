import { Fragment } from "react";
import { useTranslation } from "react-i18next";

import type { EffectiveEq } from "@/hooks/use-effective-eq";
import {
  SMART_EQ_CHAIN,
  SMART_EQ_SOURCE_LABEL_KEYS,
} from "@/lib/equalizer-labels";
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
        ? t("player.equalizer.genre.from", { name: eq.inheritedFrom.name })
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
              {t(SMART_EQ_SOURCE_LABEL_KEYS[source])}
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
