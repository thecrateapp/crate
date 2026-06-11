import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { cn } from "@crate/ui/lib/cn";

interface AppModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  maxWidthClassName?: string;
  panelClassName?: string;
  overlayClassName?: string;
  closeOnOverlay?: boolean;
  closeOnEscape?: boolean;
  lockBodyScroll?: boolean;
  mobileSafeArea?: boolean;
}

interface ModalSectionProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function AppModal({
  open,
  onClose,
  children,
  maxWidthClassName = "sm:max-w-2xl",
  panelClassName,
  overlayClassName,
  closeOnOverlay = true,
  closeOnEscape = true,
  lockBodyScroll = true,
  mobileSafeArea = false,
}: AppModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    if (lockBodyScroll) {
      document.body.style.overflow = "hidden";
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && closeOnEscape) {
        onClose();
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter(
        (element) =>
          !element.hasAttribute("disabled") &&
          element.getAttribute("aria-hidden") !== "true",
      );
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
        return;
      }
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      if (lockBodyScroll) {
        document.body.style.overflow = previousOverflow;
      }
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeOnEscape, lockBodyScroll, onClose, open]);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedElementRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const firstFocusable =
        panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (firstFocusable ?? panel).focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      const previous = previouslyFocusedElementRef.current;
      if (previous && document.contains(previous)) {
        previous.focus();
      }
      previouslyFocusedElementRef.current = null;
    };
  }, [open]);

  // Swipe-to-dismiss (mobile bottom sheet — drag handle only)
  const [isDragging, setIsDragging] = useState(false);
  const [isDragClosing, setIsDragClosing] = useState(false);
  const [swipeY, setSwipeY] = useState(0);
  const swipeYRef = useRef(0);
  const swipeStartRef = useRef<number | null>(null);
  const dragHandleRef = useRef<HTMLDivElement>(null);
  const dragCloseTimerRef = useRef<number | null>(null);
  const setDragOffset = useCallback((offset: number) => {
    swipeYRef.current = offset;
    setSwipeY(offset);
  }, []);
  const getPanelHeight = useCallback(() => {
    const height = panelRef.current?.getBoundingClientRect().height ?? 0;
    return height > 0 ? height : 240;
  }, []);
  const requestDragClose = useCallback(() => {
    if (isDragClosing) return;
    setIsDragging(false);
    setIsDragClosing(true);
    setDragOffset(getPanelHeight() + 24);
    dragCloseTimerRef.current = window.setTimeout(() => {
      onClose();
    }, 180);
  }, [getPanelHeight, isDragClosing, onClose, setDragOffset]);
  const onSwipeStart = useCallback(
    (e: React.TouchEvent) => {
      if (!dragHandleRef.current) return;
      const handleRect = dragHandleRef.current.getBoundingClientRect();
      const touchY = e.touches[0]!.clientY;
      if (touchY > handleRect.bottom + 8) return;
      e.stopPropagation();
      swipeStartRef.current = touchY;
      setIsDragging(true);
      setDragOffset(0);
    },
    [setDragOffset],
  );
  const onSwipeMove = useCallback(
    (e: React.TouchEvent) => {
      if (swipeStartRef.current === null) return;
      e.preventDefault();
      e.stopPropagation();
      const dy = e.touches[0]!.clientY - swipeStartRef.current;
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
  const onSwipeCancel = useCallback(() => {
    setIsDragging(false);
    setDragOffset(0);
    swipeStartRef.current = null;
  }, [setDragOffset]);
  const isDismissedRef = useRef(false);
  const handleOverlayPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!closeOnOverlay) return;
      event.preventDefault();
      event.stopPropagation();
      isDismissedRef.current = true;
      onClose();
    },
    [closeOnOverlay, onClose],
  );

  const handleOverlayClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!closeOnOverlay) return;
      if (isDismissedRef.current) {
        isDismissedRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onClose();
    },
    [closeOnOverlay, onClose],
  );

  useEffect(() => {
    if (open) {
      setIsDragging(false);
      setIsDragClosing(false);
      setDragOffset(0);
      return;
    }
  }, [open, setDragOffset]);

  useEffect(() => {
    return () => {
      if (dragCloseTimerRef.current != null) {
        window.clearTimeout(dragCloseTimerRef.current);
      }
    };
  }, []);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className={cn(
        "z-app-modal fixed inset-0 flex items-end justify-center bg-black/72 p-0 backdrop-blur-md animate-fade-in sm:items-center sm:p-6",
        overlayClassName,
      )}
      onClick={handleOverlayClick}
      onPointerDown={handleOverlayPointerDown}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "bg-modal-surface w-full overflow-hidden rounded-t-3xl border border-white/10 shadow-2xl sm:rounded-3xl",
          isDragClosing ? "" : "animate-sheet-up sm:animate-pop-in",
          mobileSafeArea
            ? "max-h-[calc(var(--listen-viewport-height)-var(--listen-safe-top)-0.75rem)] pb-[var(--listen-safe-bottom)] sm:max-h-[92vh] sm:pb-0"
            : "max-h-[92vh]",
          maxWidthClassName,
          panelClassName,
        )}
        style={{
          transform: swipeY > 0 ? `translateY(${swipeY}px)` : undefined,
          transition: isDragging
            ? "none"
            : "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          isDismissedRef.current = false;
          event.stopPropagation();
        }}
        onTouchStart={onSwipeStart}
        onTouchMove={onSwipeMove}
        onTouchEnd={onSwipeEnd}
        onTouchCancel={onSwipeCancel}
      >
        {/* Drag handle — visible on mobile only */}
        <div
          ref={dragHandleRef}
          className={cn(
            "flex justify-center sm:hidden",
            mobileSafeArea ? "touch-pan-y pt-4 pb-3" : "pt-2 pb-1",
          )}
        >
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ModalHeader({
  children,
  className,
  ...props
}: ModalSectionProps) {
  return (
    <div
      {...props}
      className={cn(
        "sticky top-0 z-10 border-b border-white/10 bg-modal-surface backdrop-blur-xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ModalBody({
  children,
  className,
  ...props
}: ModalSectionProps) {
  return (
    <div {...props} className={cn("overflow-y-auto", className)}>
      {children}
    </div>
  );
}

export function ModalFooter({
  children,
  className,
  ...props
}: ModalSectionProps) {
  return (
    <div
      {...props}
      className={cn(
        "sticky bottom-0 z-10 border-t border-white/10 bg-modal-surface backdrop-blur-xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

interface ModalCloseButtonProps {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

export function ModalCloseButton({
  onClick,
  disabled = false,
  className,
}: ModalCloseButtonProps) {
  return (
    <button
      type="button"
      aria-label="Close"
      className={cn(
        "rounded-full p-2 text-white/60 hover:text-white hover:bg-white/5 transition-colors",
        className,
      )}
      onClick={onClick}
      disabled={disabled}
    >
      <X size={18} />
    </button>
  );
}
