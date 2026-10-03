import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@crate/ui/lib/cn";
import { useSheetDrag } from "@crate/ui/lib/use-sheet-drag";

import type { MobileActionSheetProps } from "./types";

export function MobileActionSheet({
  children,
  panelRef,
  onClose,
  open,
  className,
  ariaLabel = "Action sheet",
  surfaceClassName = "listen-glass-panel",
}: MobileActionSheetProps) {
  const [shouldRender, setShouldRender] = useState(open);
  const [isClosing, setIsClosing] = useState(false);
  const [isEntering, setIsEntering] = useState(open);
  const internalPanelRef = useRef<HTMLDivElement>(null);
  const resolvedPanelRef = panelRef ?? internalPanelRef;
  const closeScheduledRef = useRef(false);
  const isDismissedRef = useRef(false);
  const shouldSuppressNextClickRef = useRef(false);
  const isMountedRef = useRef(true);

  const {
    dragHandleRef,
    dragHandleProps,
    swipeY,
    isDragging,
    setIsDragging,
    setDragOffset,
    getDismissOffset,
    resetDrag,
  } = useSheetDrag({
    panelRef: resolvedPanelRef,
    enabled: shouldRender,
    onDragStart: () => setIsEntering(false),
    onDismiss: () => requestDragClose(),
  });

  const isPanelTarget = useCallback(
    (target: EventTarget | null) => {
      if (target == null) return false;
      const node = target as Node;
      if (resolvedPanelRef.current?.contains(node)) return true;
      return (
        target instanceof Element &&
        Boolean(target.closest("[data-dismissible-layer-boundary]"))
      );
    },
    [resolvedPanelRef],
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      setIsClosing(false);
      setIsEntering(true);
      setIsDragging(false);
      setDragOffset(0);
      closeScheduledRef.current = false;
      return;
    }

    setIsClosing(true);
    const timer = window.setTimeout(() => {
      setShouldRender(false);
    }, 180);

    return () => window.clearTimeout(timer);
  }, [open, setDragOffset, setIsDragging]);

  useEffect(() => {
    if (!shouldRender) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyOverscroll = document.body.style.overscrollBehavior;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousHtmlOverscroll =
      document.documentElement.style.overscrollBehavior;

    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.overscrollBehavior = previousBodyOverscroll;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.documentElement.style.overscrollBehavior =
        previousHtmlOverscroll;
    };
  }, [shouldRender]);

  const requestClose = useCallback(() => {
    if (isClosing || closeScheduledRef.current) return;
    closeScheduledRef.current = true;
    setIsClosing(true);
    setIsDragging(false);
    setDragOffset(0);
    shouldSuppressNextClickRef.current = true;
    window.setTimeout(() => {
      if (isMountedRef.current) {
        closeScheduledRef.current = false;
        onClose();
      }
    }, 140);
  }, [isClosing, onClose, setDragOffset, setIsDragging]);

  const requestDragClose = useCallback(() => {
    if (isClosing || closeScheduledRef.current) return;
    closeScheduledRef.current = true;
    setIsDragging(false);
    setIsClosing(true);
    setDragOffset(getDismissOffset());
    shouldSuppressNextClickRef.current = true;
    window.setTimeout(() => {
      if (isMountedRef.current) {
        closeScheduledRef.current = false;
        onClose();
      }
    }, 180);
  }, [getDismissOffset, isClosing, onClose, setDragOffset, setIsDragging]);

  const suppressAndRequestClose = useCallback(() => {
    shouldSuppressNextClickRef.current = true;
    isDismissedRef.current = true;
    requestClose();
  }, [requestClose]);

  const handleOverlayClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (isPanelTarget(event.target)) return;
      if (isDismissedRef.current || shouldSuppressNextClickRef.current) {
        isDismissedRef.current = false;
        shouldSuppressNextClickRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      suppressAndRequestClose();
    },
    [isPanelTarget, suppressAndRequestClose],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (isPanelTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      suppressAndRequestClose();
    },
    [isPanelTarget, suppressAndRequestClose],
  );

  if (!shouldRender) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      tabIndex={-1}
      className={cn(
        "fixed inset-0 flex items-end justify-center bg-surface-canvas/58 p-0 backdrop-blur-md z-app-modal",
        isClosing ? "animate-fade-out" : "animate-fade-in",
      )}
      onClickCapture={handleOverlayClick}
      onPointerDownCapture={handlePointerDown}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        suppressAndRequestClose();
      }}
      onTouchEnd={(event) => {
        if (isPanelTarget(event.target)) return;
        resetDrag();
      }}
    >
      <div
        ref={resolvedPanelRef}
        data-dismissible-layer-boundary="true"
        className={cn(
          surfaceClassName,
          "fixed inset-x-0 overflow-hidden overscroll-contain rounded-t-3xl border border-border-quiet shadow-2xl",
          isClosing && swipeY === 0
            ? "animate-sheet-down"
            : isEntering && !isDragging
              ? "animate-sheet-up"
              : undefined,
          className,
        )}
        style={{
          top: "auto",
          left: 0,
          right: 0,
          bottom: "0px",
          maxHeight:
            "min(88vh, max(14rem, calc(var(--listen-viewport-height, 100dvh) - var(--listen-safe-top, env(safe-area-inset-top, 0px)) - 0.75rem)))",
          paddingBottom:
            "var(--listen-safe-bottom, env(safe-area-inset-bottom, 0px))",
          transform: swipeY ? `translateY(${swipeY}px)` : undefined,
          transition: isDragging
            ? "none"
            : "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div
          ref={dragHandleRef}
          data-mobile-sheet-drag-handle="true"
          className="touch-none pt-3 pb-2"
          {...dragHandleProps}
        >
          <div className="mx-auto h-1.25 w-14 rounded-full bg-text-primary/22 transition-opacity duration-150 group-hover:opacity-90" />
        </div>
        <div className="max-h-[inherit] overflow-y-auto overscroll-contain">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
