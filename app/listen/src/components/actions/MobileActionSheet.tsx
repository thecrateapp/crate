import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
  type TouchEvent as ReactTouchEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

interface MobileActionSheetProps {
  children: ReactNode;
  panelRef?: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  open: boolean;
  className?: string;
}

export function MobileActionSheet({
  children,
  panelRef,
  onClose,
  open,
  className,
}: MobileActionSheetProps) {
  const [shouldRender, setShouldRender] = useState(open);
  const [isClosing, setIsClosing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [swipeY, setSwipeY] = useState(0);
  const swipeYRef = useRef(0);
  const swipeStartRef = useRef<number | null>(null);
  const dragHandleRef = useRef<HTMLDivElement>(null);
  const closeScheduledRef = useRef(false);
  const isDismissedRef = useRef(false);
  const shouldSuppressNextClickRef = useRef(false);
  const isMountedRef = useRef(true);

  const isPanelTarget = useCallback(
    (target: EventTarget | null) => {
      if (target == null) return false;
      const node = target as Node;
      return panelRef?.current ? panelRef.current.contains(node) : false;
    },
    [panelRef],
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
      setIsDragging(false);
      setSwipeY(0);
      swipeYRef.current = 0;
      closeScheduledRef.current = false;
      return;
    }

    setIsClosing(true);
    const timer = window.setTimeout(() => {
      setShouldRender(false);
    }, 180);

    return () => window.clearTimeout(timer);
  }, [open]);

  const setDragOffset = useCallback((offset: number) => {
    swipeYRef.current = offset;
    setSwipeY(offset);
  }, []);

  const getPanelHeight = useCallback(() => {
    const height = panelRef?.current?.getBoundingClientRect().height ?? 0;
    return height > 0 ? height : 240;
  }, [panelRef]);

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
  }, [isClosing, onClose, setDragOffset]);

  const requestDragClose = useCallback(() => {
    if (isClosing || closeScheduledRef.current) return;
    closeScheduledRef.current = true;
    setIsDragging(false);
    setIsClosing(true);
    setDragOffset(getPanelHeight() + 24);
    shouldSuppressNextClickRef.current = true;
    window.setTimeout(() => {
      if (isMountedRef.current) {
        closeScheduledRef.current = false;
        onClose();
      }
    }, 180);
  }, [getPanelHeight, isClosing, onClose, setDragOffset]);

  const suppressAndRequestClose = useCallback(() => {
    shouldSuppressNextClickRef.current = true;
    isDismissedRef.current = true;
    requestClose();
  }, [requestClose]);

  const handleOverlayTouchStart = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      if (isPanelTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      suppressAndRequestClose();
    },
    [suppressAndRequestClose],
  );

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
    [suppressAndRequestClose],
  );

  const handlePanelTouchStart = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      event.stopPropagation();
      const firstTouch = event.touches[0];
      if (firstTouch == null) return;
      swipeStartRef.current = firstTouch.clientY;
      setIsDragging(true);
      setDragOffset(0);
    },
    [setDragOffset],
  );

  const onSwipeMove = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      if (swipeStartRef.current === null) return;
      event.preventDefault();
      event.stopPropagation();
      const dy = event.touches[0]!.clientY - swipeStartRef.current;
      setDragOffset(dy > 0 ? Math.min(dy, getPanelHeight() + 24) : 0);
    },
    [getPanelHeight, setDragOffset],
  );

  const onSwipeEnd = useCallback(() => {
    if (swipeStartRef.current === null) return;
    const shouldDismiss = swipeYRef.current >= getPanelHeight() / 2;
    swipeStartRef.current = null;
    if (shouldDismiss) {
      requestDragClose();
      return;
    }
    setIsDragging(false);
    setDragOffset(0);
  }, [getPanelHeight, requestDragClose, setDragOffset]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (isPanelTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      suppressAndRequestClose();
    },
    [isPanelTarget, suppressAndRequestClose],
  );

  const handleContentTouchStart = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      if (!event.target) return;
      if (!dragHandleRef.current) return;
      const isHandle = dragHandleRef.current.contains(
        event.target as Node | null,
      );
      if (!isHandle) {
        event.stopPropagation();
      }
    },
    [],
  );

  const handleContentTouchCancel = useCallback(() => {
    setIsDragging(false);
    setDragOffset(0);
    swipeStartRef.current = null;
  }, [setDragOffset]);

  if (!shouldRender) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className={cn(
        "fixed inset-0 flex items-end justify-center bg-black/58 p-0 backdrop-blur-md z-app-modal",
        isClosing ? "animate-fade-out" : "animate-fade-in",
      )}
      onClickCapture={handleOverlayClick}
      onPointerDownCapture={handlePointerDown}
      onTouchStartCapture={handleOverlayTouchStart}
      onTouchEnd={(event) => {
        if (isPanelTarget(event.target)) return;
        setIsDragging(false);
        setDragOffset(0);
        swipeStartRef.current = null;
      }}
    >
      <div
        ref={panelRef}
        className={cn(
          "listen-glass-panel fixed inset-x-0 overflow-hidden rounded-t-3xl border border-white/10 shadow-2xl",
          isClosing && swipeY === 0 ? "animate-sheet-down" : "animate-sheet-up",
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
          className="touch-pan-y pt-3 pb-2"
          onTouchStart={handlePanelTouchStart}
          onTouchMove={onSwipeMove}
          onTouchEnd={onSwipeEnd}
          onTouchCancel={handleContentTouchCancel}
        >
          <div className="mx-auto h-1.25 w-14 rounded-full bg-white/22 transition-opacity duration-150 group-hover:opacity-90" />
        </div>
        <div
          className="max-h-[inherit] overflow-y-auto"
          onTouchStart={handleContentTouchStart}
          onTouchMove={onSwipeMove}
          onTouchEnd={onSwipeEnd}
          onTouchCancel={handleContentTouchCancel}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
