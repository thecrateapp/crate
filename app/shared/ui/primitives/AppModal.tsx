import {
  createContext,
  useContext,
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
import { OverlayCloseButton } from "@crate/ui/shadcn/overlay-close-button";

import { acquireBodyScrollLock } from "@crate/ui/lib/body-scroll-lock";
import { cn } from "@crate/ui/lib/cn";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { useModalFocus } from "@crate/ui/lib/use-modal-focus";
import { useSheetDrag } from "@crate/ui/lib/use-sheet-drag";

export type AppModalSize = "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";

export interface AppModalProps {
  open: boolean;
  onClose: () => void;
  children?: ReactNode;
  title?: ReactNode;
  eyebrow?: ReactNode;
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

const ModalDepth = createContext(0);

export function AppModal({
  open,
  onClose,
  children,
  title,
  eyebrow,
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
  panelClassName,
  overlayClassName,
  closeOnOverlay = true,
  closeOnEscape = true,
  lockBodyScroll = true,
  mobileSafeArea = false,
}: AppModalProps) {
  const depth = useContext(ModalDepth);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const hasTitle = title != null && title !== false;
  const hasDescription = description != null && description !== false;
  const labelledBy = ariaLabelledBy ?? (hasTitle ? titleId : undefined);
  const describedBy =
    ariaDescribedBy ?? (hasTitle && hasDescription ? descriptionId : undefined);
  useModalFocus({
    active: open,
    panelRef,
    onEscape: (event) => {
      if (!closeOnEscape) return;
      event.preventDefault();
      onClose();
    },
  });

  useEffect(() => {
    if (!open) return undefined;

    const releaseScrollLock = lockBodyScroll
      ? acquireBodyScrollLock(document)
      : undefined;

    return () => releaseScrollLock?.();
  }, [lockBodyScroll, open]);

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
    <ModalDepth value={depth + 1}>
      <dialog
        open
        role={role}
        aria-modal="true"
        aria-label={labelledBy ? undefined : ariaLabel}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        style={
          depth ? { zIndex: `calc(var(--z-modal) + ${depth})` } : undefined
        }
        className={cn(
          "crate-overlay-scrim z-app-modal fixed inset-0 m-0 flex h-full max-h-none w-full max-w-none items-end justify-center border-0 p-0 text-inherit sm:items-center sm:p-6",
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
          data-modal-depth={depth}
          data-overlay-size={size ?? "lg"}
          tabIndex={-1}
          className={cn(
            "crate-overlay-panel relative z-10 flex min-h-0 w-full flex-col overflow-hidden overscroll-contain",
            isDragClosing
              ? undefined
              : isEntering && !isDragging
                ? "crate-overlay-enter"
                : undefined,
            mobileSafeArea
              ? "max-h-[calc(var(--listen-viewport-height)-var(--listen-safe-top)-0.75rem)] pb-[var(--listen-safe-bottom)] sm:max-h-[92vh] sm:pb-0"
              : "max-h-[92vh]",
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
            <div className="crate-overlay-grabber" />
          </div>
          {hasTitle ? (
            <ModalHeader
              className={cn(
                "flex items-center justify-between gap-4 px-5 py-4",
                headerClassName,
              )}
            >
              <div className="min-w-0 pr-12">
                {eyebrow != null ? (
                  <MonoLabel size="eyebrow" className="mb-2">
                    {eyebrow}
                  </MonoLabel>
                ) : null}
                <h2 id={titleId} className="crate-overlay-title">
                  {title}
                </h2>
                {hasDescription ? (
                  <p id={descriptionId} className="crate-overlay-body mt-2">
                    {description}
                  </p>
                ) : null}
              </div>
            </ModalHeader>
          ) : null}
          {hasTitle ? (
            <ModalCloseButton
              className="absolute top-4 right-4 z-20"
              onClick={onClose}
              disabled={closeDisabled}
              label={closeLabel}
            />
          ) : null}
          {children}
        </div>
      </dialog>
    </ModalDepth>,
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
        "sticky top-0 z-10 border-b border-border-quiet bg-surface-popover",
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
      className={cn(
        "crate-overlay-body min-h-0 flex-1 overflow-y-auto overscroll-contain",
        className,
      )}
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
        "crate-overlay-footer sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 bg-surface-popover px-5 py-4",
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
    <OverlayCloseButton
      aria-label={label}
      className={className}
      onClick={onClick}
      disabled={disabled}
    />
  );
}
