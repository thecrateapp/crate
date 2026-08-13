import { useRef } from "react";

import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
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
  const panelRef = useRef<HTMLDivElement>(null);

  useDismissibleLayer({
    active: open,
    refs: [panelRef],
    onDismiss: onClose,
  });

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Equalizer"
      className="z-app-player-drawer fixed bottom-[calc(var(--listen-mobile-bottom-chrome-height)+0.75rem)] right-3 w-[min(calc(100vw-1.5rem),560px)] animate-fade-in rounded-[12px] border border-white/10 bg-black/80 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur-2xl md:bottom-[92px]"
    >
      <EqualizerPanel onClose={onClose} />
    </div>
  );
}
