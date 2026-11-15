import { useTranslation } from "react-i18next";
import { Layers } from "@crate/ui/icons";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";

import type { PlaylistSmartMix } from "@/lib/smart-mix-playlists";

/**
 * The Smart Mix mark of a playlist (approved mockup A, 2026-11-09): ``ready/total``
 * while the server separates its tracks, "Smart Mix" once every track has stems, and
 * on phones only the icon once ready.
 */
export function SmartMixChip({ smartMix }: { smartMix: PlaylistSmartMix }) {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  if (!smartMix.enabled) return null;
  const done = smartMix.ready >= smartMix.total;
  const title = done
    ? t("playlist.smartMix.titleReady", { total: smartMix.total })
    : t("playlist.smartMix.titlePartial", {
        ready: smartMix.ready,
        total: smartMix.total,
      });
  if (done && !isDesktop) {
    return (
      <InfoBadge
        variant="icon"
        icon={Layers}
        tone="accent"
        title={title}
        aria-label={title}
        data-smart-mix="chip"
      />
    );
  }
  return (
    <InfoBadge icon={Layers} tone="accent" title={title} data-smart-mix="chip">
      {done
        ? t("playlist.smartMix.label")
        : `${smartMix.ready}/${smartMix.total}`}
    </InfoBadge>
  );
}
