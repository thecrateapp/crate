import { createPortal } from "react-dom";
import type { ReactNode, RefObject } from "react";

import { cn } from "@/lib/utils";

interface MobileActionSheetProps {
  children: ReactNode;
  panelRef?: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  className?: string;
}

export function MobileActionSheet({
  children,
  panelRef,
  onClose,
  className,
}: MobileActionSheetProps) {
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 flex items-end justify-center bg-black/58 p-0 backdrop-blur-md animate-fade-in"
      style={{ zIndex: 1700 }}
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onTouchStart={(event) => {
        event.stopPropagation();
      }}
    >
      <div
        ref={panelRef}
        className={cn(
          "listen-glass-panel fixed inset-x-3 overflow-hidden rounded-3xl animate-sheet-up",
          className,
        )}
        style={{
          bottom: "calc(var(--listen-mobile-bottom-chrome-height) + 0.75rem)",
          maxHeight:
            "max(14rem, calc(var(--listen-viewport-height) - var(--listen-safe-top) - var(--listen-mobile-bottom-chrome-height) - 1.75rem))",
        }}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
      >
        <div className="flex justify-center px-4 pb-2 pt-3">
          <div className="h-1 w-10 rounded-full bg-white/22" />
        </div>
        <div className="max-h-[inherit] overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
