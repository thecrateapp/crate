import { useEffect, useRef, type ReactNode } from "react";

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
  title: ReactNode;
  description?: ReactNode;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  closeLabel?: string;
  tone?: ConfirmDialogTone;
  variant?: "default" | "destructive";
  pending?: boolean;
  initialFocus?: "cancel" | "confirm";
  size?: AppModalSize;
}

function isPromiseLike(value: unknown): value is Promise<void> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Promise<void>).then === "function"
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  onCancel,
  onConfirm,
  title,
  description,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  closeLabel,
  tone,
  variant,
  pending = false,
  initialFocus,
  size = "sm",
}: ConfirmDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
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

  const handleConfirm = () => {
    if (pending) return;
    const result = onConfirm();
    if (!onOpenChange) return;
    if (isPromiseLike(result)) {
      void result.then(
        () => onOpenChange(false),
        () => undefined,
      );
      return;
    }
    onOpenChange(false);
  };

  return (
    <AppModal
      open={open}
      onClose={handleCancel}
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
          onClick={handleConfirm}
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
