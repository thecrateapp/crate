import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { AudioLines } from "@crate/ui/icons";
import type { QualityBadge as QualityBadgeData } from "./player-bar-utils";

type QualityBadgeOrigin = "source" | "stream";

export function QualityBadge({
  badge,
  origin = "source",
}: {
  badge: QualityBadgeData;
  origin?: QualityBadgeOrigin;
}) {
  const title =
    origin === "stream"
      ? `Streaming delivery quality · ${badge.detail || badge.label}`
      : badge.detail || badge.label;

  return (
    <InfoBadge
      icon={AudioLines}
      data-quality-tier={badge.tier}
      data-quality-origin={origin}
      tone={
        badge.tier === "hi-res"
          ? "warning"
          : badge.tier === "lossless" || badge.tier === "high"
            ? "accent"
            : "neutral"
      }
      title={title}
    >
      {badge.label}
    </InfoBadge>
  );
}
