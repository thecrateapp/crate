import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type HTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CRATE_ICON_SIZE, X } from "@crate/ui/icons";

import { cn } from "@crate/ui/lib/cn";
import { useSheetDrag } from "@crate/ui/lib/use-sheet-drag";

export type AppModalSize = "sm" | "md" | "lg" | "xl";

const MODAL_SIZE_CLASS_NAMES: Record<AppModalSize, string> = {
  sm: "sm:max-w-md",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
};

const DEFAULT_MAX_WIDTH_CLASS_NAME = MODAL_SIZE_CLASS_NAMES.lg;

export interface AppModalProps {
  open: boolean;
  onClose: () => void;
  children?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  size?: AppModalSize;
  role?: "dialog" | "alertdialog";
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  closeLabel?: string;
  closeDisabled?: boolean;
  backdropLabel?: string;
  headerClassName?: string;
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
  title,
  description,
  size,
  role = "dialog",
  ariaLabel = "Dialog",
  ariaLabelledBy,
  ariaDescribedBy,
  closeLabel,
  closeDisabled = false,
  backdropLabel = "Close dialog backdrop",
  headerClassName,
  maxWidthClassName,
  panelClassName,
  overlayClassName,
  closeOnOverlay = true,
  closeOnEscape = true,
  lockBodyScroll = true,
  mobileSafeArea = false,
}: AppModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const hasTitle = title != null && title !== false;
  const hasDescription = description != null && description !== false;
  const labelledBy = ariaLabelledBy ?? (hasTitle ? titleId : undefined);
  const describedBy =
    ariaDescribedBy ?? (hasTitle && hasDescription ? descriptionId : undefined);
  const resolvedMaxWidthClassName =
    maxWidthClassName ??
    (size ? MODAL_SIZE_CLASS_NAMES[size] : DEFAULT_MAX_WIDTH_CLASS_NAME);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    const previousBodyOverscroll = document.body.style.overscrollBehavior;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousHtmlOverscroll =
      document.documentElement.style.overscrollBehavior;
    if (lockBodyScroll) {
      document.body.style.overflow = "hidden";
      document.body.style.overscrollBehavior = "none";
      document.documentElement.style.overflow = "hidden";
      document.documentElement.style.overscrollBehavior = "none";
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
        document.body.style.overscrollBehavior = previousBodyOverscroll;
        document.documentElement.style.overflow = previousHtmlOverflow;
        document.documentElement.style.overscrollBehavior =
          previousHtmlOverscroll;
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
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement &&
        panel.contains(activeElement)
      ) {
        return;
      }
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

  const [isEntering, setIsEntering] = useState(open);
  const [isDragClosing, setIsDragClosing] = useState(false);
  const dragCloseTimerRef = useRef<number | null>(null);
  const isDragClosingRef = useRef(false);
  const {
    dragHandleRef,
    dragHandleProps,
    swipeY,
    isDragging,
    setIsDragging,
    setDragOffset,
    getDismissOffset,
  } = useSheetDrag({
    panelRef,
    enabled: open,
    onDragStart: () => setIsEntering(false),
    onDismiss: () => {
      if (isDragClosingRef.current) return;
      isDragClosingRef.current = true;
      setIsDragging(false);
      setIsDragClosing(true);
      setDragOffset(getDismissOffset());
      dragCloseTimerRef.current = window.setTimeout(() => {
        onClose();
      }, 180);
    },
  });
  const isDismissedRef = useRef(false);
  const handleOverlayPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!closeOnOverlay) return;
      event.preventDefault();
      event.stopPropagation();
      isDismissedRef.current = true;
      onClose();
    },
    [closeOnOverlay, onClose],
  );

  const handleOverlayClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
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
      isDragClosingRef.current = false;
      setIsEntering(true);
      setIsDragging(false);
      setIsDragClosing(false);
      setDragOffset(0);
      return;
    }
  }, [open, setDragOffset, setIsDragging]);

  useEffect(() => {
    return () => {
      if (dragCloseTimerRef.current != null) {
        window.clearTimeout(dragCloseTimerRef.current);
      }
    };
  }, []);

  if (!open) return null;

  return createPortal(
    <dialog
      open
      role={role === "alertdialog" ? "alertdialog" : undefined}
      aria-modal="true"
      aria-label={labelledBy ? undefined : ariaLabel}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      tabIndex={-1}
      className={cn(
        "z-app-modal fixed inset-0 m-0 flex h-full max-h-none w-full max-w-none items-end justify-center border-0 bg-surface-canvas/72 p-0 text-inherit backdrop-blur-md animate-fade-in sm:items-center sm:p-6",
        overlayClassName,
      )}
    >
      <button
        type="button"
        aria-label={backdropLabel}
        tabIndex={-1}
        className="absolute inset-0 h-full w-full cursor-default border-0 bg-transparent p-0"
        onClick={handleOverlayClick}
        onPointerDown={handleOverlayPointerDown}
      />
      <div
        ref={panelRef}
        data-app-modal-panel="true"
        tabIndex={-1}
        className={cn(
          "bg-modal-surface relative z-10 w-full overflow-hidden overscroll-contain rounded-t-3xl border border-border-quiet shadow-2xl sm:rounded-3xl",
          isDragClosing
            ? undefined
            : isEntering && !isDragging
              ? "animate-sheet-up sm:animate-pop-in"
              : undefined,
          mobileSafeArea
            ? "max-h-[calc(var(--listen-viewport-height)-var(--listen-safe-top)-0.75rem)] pb-[var(--listen-safe-bottom)] sm:max-h-[92vh] sm:pb-0"
            : "max-h-[92vh]",
          resolvedMaxWidthClassName,
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
      >
        <div
          ref={dragHandleRef}
          data-mobile-sheet-drag-handle="true"
          className={cn(
            "flex justify-center sm:hidden",
            mobileSafeArea ? "touch-none pt-4 pb-3" : "touch-none pt-2 pb-1",
          )}
          {...dragHandleProps}
        >
          <div className="w-10 h-1 rounded-full bg-text-primary/20" />
        </div>
        {hasTitle ? (
          <ModalHeader
            className={cn(
              "flex items-center justify-between gap-4 px-5 py-4",
              headerClassName,
            )}
          >
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-lg font-semibold text-text-primary"
              >
                {title}
              </h2>
              {hasDescription ? (
                <p id={descriptionId} className="text-xs text-text-muted">
                  {description}
                </p>
              ) : null}
            </div>
            <ModalCloseButton
              onClick={onClose}
              disabled={closeDisabled}
              label={closeLabel}
            />
          </ModalHeader>
        ) : null}
        {children}
      </div>
    </dialog>,
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
        "sticky top-0 z-10 border-b border-border-quiet bg-modal-surface backdrop-blur-xl",
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
    <div
      {...props}
      className={cn("overflow-y-auto overscroll-contain", className)}
    >
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
        "sticky bottom-0 z-10 border-t border-border-quiet bg-modal-surface backdrop-blur-xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface ModalCloseButtonProps {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  label?: string;
}

export function ModalCloseButton({
  onClick,
  disabled = false,
  className,
  label = "Close",
}: ModalCloseButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "flex size-10 items-center justify-center rounded-full text-text-primary/55 transition-[color,box-shadow] hover:text-text-primary focus-visible:text-text-primary focus-visible:shadow-focus focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      onClick={onClick}
      disabled={disabled}
    >
      <X size={CRATE_ICON_SIZE.xl} />
    </button>
  );
}
