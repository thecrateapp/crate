import { useTranslation } from "react-i18next";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import type { PlayerMixPresentation } from "./player-mix-presentation";

export function PlayerMixIndicator({
  mix,
}: {
  mix: PlayerMixPresentation | null;
}) {
  const { t } = useTranslation();
  const label = !mix
    ? null
    : mix.mode === "gapless"
      ? t("player.mix.gapless")
      : mix.mode === "beatmatch"
        ? t("settings.playback.smartMixBeatmatch")
        : t("settings.playback.crossfade");
  return (
    <div
      role="status"
      aria-label={t("player.mix.label")}
      aria-live="polite"
      aria-atomic="true"
      data-slot="player-mix-indicator"
      data-mix-mode={mix?.mode}
      data-mix-active={mix?.activity === "mixing" || undefined}
      className="pointer-events-none absolute inset-x-12 top-0 flex h-[18px] min-h-4 items-center justify-center gap-2"
      style={mix ? { color: mix.color } : undefined}
    >
      {mix ? (
        <>
          <StatusDot
            tone={mix.activity === "mixing" ? "on" : "off"}
            className="text-inherit"
          />
          <MonoLabel as="span" className="min-w-0 truncate text-inherit">
            {label}
            {mix.bassHandoff ? (
              <> · {t("settings.playback.smartMixBassHandoff")}</>
            ) : null}
            {mix.activity === "paused" ? <> · {t("player.mix.paused")}</> : null}
            {mix.activity === "buffering" ? (
              <> · {t("player.mix.buffering")}</>
            ) : null}
          </MonoLabel>
        </>
      ) : null}
    </div>
  );
}
