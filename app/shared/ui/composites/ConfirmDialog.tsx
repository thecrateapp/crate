import { useEffect, useRef, useState, type ReactNode } from "react";

import { CRATE_ICON_SIZE, Loader2 } from "@crate/ui/icons";
import {
  AppModal,
  ModalBody,
  ModalFooter,
  type AppModalSize,
} from "@crate/ui/primitives/AppModal";
import { Button } from "@crate/ui/shadcn/button";

export type ConfirmDialogTone = "default" | "danger";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  onCancel?: () => void;
  onConfirm: () => void | Promise<void>;
  onError?: (error: unknown) => void;
  title: ReactNode;
  description?: ReactNode;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  closeLabel?: string;
  ariaLabel?: string;
  backdropLabel?: string;
  tone?: ConfirmDialogTone;
  variant?: "default" | "destructive";
  pending?: boolean;
  initialFocus?: "cancel" | "confirm";
  size?: AppModalSize;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  onCancel,
  onConfirm,
  onError,
  title,
  description,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  closeLabel = "Close",
  ariaLabel = "Confirmation dialog",
  backdropLabel = "Close dialog backdrop",
  tone,
  variant,
  pending: controlledPending,
  initialFocus,
  size = "sm",
}: ConfirmDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const submittingRef = useRef(false);
  const [internalPending, setInternalPending] = useState(false);
  const isPendingControlled = controlledPending !== undefined;
  const pending = isPendingControlled ? controlledPending : internalPending;
  const resolvedTone: ConfirmDialogTone =
    tone ?? (variant === "destructive" ? "danger" : "default");
  const resolvedInitialFocus =
    initialFocus ?? (resolvedTone === "danger" ? "cancel" : "confirm");

  useEffect(() => {
    if (!open) return;
    const target =
      resolvedInitialFocus === "cancel"
        ? cancelButtonRef.current
        : confirmButtonRef.current;
    target?.focus();
  }, [open, resolvedInitialFocus]);

  const handleCancel = () => {
    if (pending) return;
    onCancel?.();
    onOpenChange?.(false);
  };

  const handleConfirm = async () => {
    if (pending || submittingRef.current) return;
    submittingRef.current = true;
    if (!isPendingControlled) setInternalPending(true);
    try {
      await onConfirm();
      onOpenChange?.(false);
    } catch (error) {
      onError?.(error);
    } finally {
      submittingRef.current = false;
      if (!isPendingControlled) setInternalPending(false);
    }
  };

  return (
    <AppModal
      open={open}
      onClose={handleCancel}
      role="alertdialog"
      ariaLabel={ariaLabel}
      backdropLabel={backdropLabel}
      title={title}
      description={description}
      size={size}
      closeLabel={closeLabel}
      closeDisabled={pending}
      closeOnOverlay={!pending}
      closeOnEscape={!pending}
    >
      {body != null ? (
        <ModalBody className="px-5 py-4 text-sm text-text-secondary">
          {body}
        </ModalBody>
      ) : null}
      <ModalFooter className="flex flex-col-reverse gap-2 border-t-0 bg-transparent px-5 py-4 sm:flex-row sm:justify-end">
        <Button
          ref={cancelButtonRef}
          type="button"
          variant="outline"
          disabled={pending}
          onClick={handleCancel}
        >
          {cancelLabel}
        </Button>
        <Button
          ref={confirmButtonRef}
          type="button"
          variant={resolvedTone === "danger" ? "destructive" : "default"}
          disabled={pending}
          aria-busy={pending || undefined}
          data-tone={resolvedTone}
          onClick={() => void handleConfirm()}
        >
          {pending ? (
            <Loader2
              size={CRATE_ICON_SIZE.sm}
              className="animate-spin"
              aria-hidden="true"
            />
          ) : null}
          {confirmLabel}
        </Button>
      </ModalFooter>
    </AppModal>
  );
}
