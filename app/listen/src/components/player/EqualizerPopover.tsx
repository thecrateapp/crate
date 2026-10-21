import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
import { EqualizerFloatingSurface } from "./EqualizerPanelSurface";
import { EqualizerPanel } from "@/components/player/EqualizerPanel";

interface EqualizerPopoverProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Floating equalizer panel anchored bottom-right of the viewport.
 * Sits above the player bar (z-app-player-drawer tier), closes on
 * click outside, Escape, or the X inside the panel header.
 */
export function EqualizerPopover({ open, onClose }: EqualizerPopoverProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDialogElement>(null);

  useDismissibleLayer({
    active: open,
    refs: [panelRef],
    onDismiss: onClose,
  });

  if (!open) return null;

  return (
    <EqualizerFloatingSurface ref={panelRef} label={t("player.equalizer")}>
      <EqualizerPanel onClose={onClose} />
    </EqualizerFloatingSurface>
  );
}
