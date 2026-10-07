import { useTranslation } from "react-i18next";
import { Brain } from "@crate/ui/icons";

import type { EffectiveEq } from "@/hooks/use-effective-eq";
import { CrateBadge } from "@crate/ui/primitives/CrateBadge";

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
      <div className="rounded-lg border border-accent-action/20 bg-accent-action/[0.07] px-3 py-2 text-xs text-accent-action/80">
        {t("player.equalizer.smart.resolving")}
      </div>
    );
  }

  if (status === "unavailable" || !eq) {
    return (
      <div className="rounded-lg border border-border-quiet bg-surface-control px-3 py-2 text-xs text-text-muted">
        {t("player.equalizer.smart.waiting")}
      </div>
    );
  }

  const label = SMART_EQ_SOURCE_LABELS[eq.source] ?? eq.label;
  const detail =
    eq.source === "genre_taxonomy_preset" && eq.genre
      ? eq.inheritedFrom
        ? `Inherited from ${eq.inheritedFrom.name}`
        : eq.genre.name
      : eq.reasoning || eq.label;

  return (
    <div className="eq-smart-surface rounded-lg border border-accent-action/25 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <CrateBadge icon={Brain}>
          {t("player.equalizer.smart.label")}
        </CrateBadge>
        <span className="text-xs font-semibold text-text-primary">{label}</span>
      </div>
      {detail ? (
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-muted">
          {detail}
        </p>
      ) : null}
    </div>
  );
}

const SMART_EQ_SOURCE_LABELS: Record<EffectiveEq["source"], string> = {
  user_track_preset: "User track preset",
  instance_track_preset: "Curator track preset",
  instance_album_preset: "Curator album preset",
  genre_taxonomy_preset: "Genre taxonomy",
  audio_analysis_preset: "Audio analysis",
  flat: "Flat",
};
