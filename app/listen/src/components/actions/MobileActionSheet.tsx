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
  const [swipeY, setSwipeY] = useState(0);
  const swipeStartRef = useRef<number | null>(null);
  const dragHandleRef = useRef<HTMLDivElement>(null);
  const closeScheduledRef = useRef(false);
  const isMountedRef = useRef(true);

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
      setSwipeY(0);
      closeScheduledRef.current = false;
      return;
    }

    setIsClosing(true);
    const timer = window.setTimeout(() => {
      setShouldRender(false);
    }, 180);

    return () => window.clearTimeout(timer);
  }, [open]);

  const requestClose = useCallback(() => {
    if (isClosing || closeScheduledRef.current) return;
    closeScheduledRef.current = true;
    setIsClosing(true);
    setSwipeY(0);
    window.setTimeout(() => {
      if (isMountedRef.current) {
        onClose();
      }
    }, 140);
  }, [isClosing, onClose]);

  const handleOverlayTouchStart = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      requestClose();
    },
    [requestClose],
  );

  const handleOverlayClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      requestClose();
    },
    [requestClose],
  );

  const handlePanelTouchStart = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      event.stopPropagation();
      const firstTouch = event.touches[0];
      if (firstTouch == null) return;
      swipeStartRef.current = firstTouch.clientY;
      setSwipeY(0);
    },
    [],
  );

  const onSwipeMove = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    if (swipeStartRef.current === null) return;
    const dy = event.touches[0]!.clientY - swipeStartRef.current;
    setSwipeY(dy > 0 ? Math.min(dy * 0.6, 240) : 0);
  }, []);

  const onSwipeEnd = useCallback(() => {
    if (swipeY > 80) {
      requestClose();
      return;
    }
    setSwipeY(0);
    swipeStartRef.current = null;
  }, [requestClose, swipeY]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      requestClose();
    },
    [requestClose],
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
    setSwipeY(0);
    swipeStartRef.current = null;
  }, []);

  if (!shouldRender) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className={cn(
        "fixed inset-0 flex items-end justify-center bg-black/58 p-0 backdrop-blur-md z-app-modal",
        isClosing ? "animate-fade-out" : "animate-fade-in",
      )}
      style={{ zIndex: 1700 }}
      onClick={handleOverlayClick}
      onPointerDown={handlePointerDown}
      onTouchStart={handleOverlayTouchStart}
      onTouchEnd={() => {
        setSwipeY(0);
        swipeStartRef.current = null;
      }}
    >
      <div
        ref={panelRef}
        className={cn(
          "listen-glass-panel fixed inset-x-0 overflow-hidden rounded-t-3xl border border-white/10 shadow-2xl",
          isClosing ? "animate-sheet-down" : "animate-sheet-up",
          className,
        )}
        style={{
          bottom: "calc(var(--listen-mobile-bottom-chrome-height) + 0.75rem)",
          maxHeight:
            "max(14rem, calc(var(--listen-viewport-height) - var(--listen-safe-top) - var(--listen-mobile-bottom-chrome-height) - 1.75rem))",
          transform: `translateY(${swipeY}px)`,
          transition: swipeY > 0 ? "none" : undefined,
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
