import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Airplay, CRATE_ICON_SIZE } from "@crate/ui/icons";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import type { PlaybackTarget } from "../../lib/playback-target-data";

export function PlaybackTargetButton({
  buttonRef,
  open,
  activeTarget,
  onToggle,
  controls,
}: {
  buttonRef: RefObject<HTMLButtonElement | null>;
  open: boolean;
  activeTarget: PlaybackTarget | undefined;
  onToggle: () => void;
  controls?: string;
}) {
  const { t } = useTranslation();
  return (
    <ActionButton
      ref={buttonRef}
      label={t("player.output.label")}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      aria-pressed={
        open || Boolean(activeTarget && activeTarget.kind !== "local")
      }
      onClick={onToggle}
    >
      <Airplay size={CRATE_ICON_SIZE.md} aria-hidden="true" />
    </ActionButton>
  );
}
