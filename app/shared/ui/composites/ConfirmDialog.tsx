import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";

import { CRATE_ICON_SIZE, Loader2 } from "@crate/ui/icons";
import { type AppModalSize } from "@crate/ui/primitives/AppModal";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { FormField } from "@crate/ui/primitives/FormField";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { OverlayCloseButton } from "@crate/ui/shadcn/overlay-close-button";

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
  eyebrow?: ReactNode;
  consequence?: ReactNode;
  confirmation?: { value: string; label: string };
  confirmLabel?: string;
  cancelLabel?: string;
  closeLabel?: string;
  ariaLabel?: string;
  backdropLabel?: string;
  tone?: ConfirmDialogTone;
  pending?: boolean;
  initialFocus?: "cancel" | "confirm";
  size?: AppModalSize;
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  return props.open ? <OpenConfirmDialog {...props} /> : null;
}

function OpenConfirmDialog({
  onOpenChange,
  onCancel,
  onConfirm,
  onError,
  title,
  description,
  body,
  eyebrow,
  consequence,
  confirmation,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  closeLabel = "Close",
  ariaLabel = "Confirmation dialog",
  backdropLabel = "Close dialog backdrop",
  tone = "default",
  pending: controlledPending = false,
  initialFocus,
  size = "sm",
}: ConfirmDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef(true);
  const submittingRef = useRef(false);
  const dismissedOnPointerDownRef = useRef(false);
  const [internalPending, setInternalPending] = useState(false);
  const [confirmationValue, setConfirmationValue] = useState("");
  const confirmationId = useId();
  const hasTitle = title != null && title !== false;
  const hasDescription = description != null && description !== false;
  const pending = controlledPending || internalPending;
  const resolvedInitialFocus =
    initialFocus ?? (tone === "danger" ? "cancel" : "confirm");
  const confirmed = !confirmation || confirmationValue === confirmation.value;

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  const handleCancel = () => {
    if (pending || submittingRef.current) return;
    onCancel?.();
    onOpenChange?.(false);
  };

  const handleConfirm = async () => {
    if (pending || submittingRef.current || !confirmed) return;
    submittingRef.current = true;
    setInternalPending(true);
    try {
      await onConfirm();
      if (activeRef.current) onOpenChange?.(false);
    } catch (error) {
      if (!activeRef.current) return;
      if (onError) onError(error);
      else console.error(error);
    } finally {
      if (activeRef.current) {
        submittingRef.current = false;
        setInternalPending(false);
      }
    }
  };

  return (
    <AlertDialogPrimitive.Root
      open
      onOpenChange={(open) => !open && handleCancel()}
    >
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="crate-overlay-scrim fixed inset-0 z-app-modal" />
        <AlertDialogPrimitive.Content
          ref={(element) => {
            if (element) contentRef.current = element;
          }}
          aria-label={hasTitle ? undefined : ariaLabel}
          {...(!hasDescription ? { "aria-describedby": undefined } : {})}
          className="fixed inset-0 z-app-modal flex items-center justify-center p-4"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const previous = document.activeElement;
            if (
              !previousFocusRef.current &&
              previous instanceof HTMLElement &&
              !contentRef.current?.contains(previous)
            ) {
              previousFocusRef.current = previous;
            }
            const target =
              resolvedInitialFocus === "cancel" || !confirmed
                ? cancelButtonRef.current
                : confirmButtonRef.current;
            target?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const active = document.activeElement;
            const shouldRestore =
              active === document.body ||
              !active ||
              contentRef.current?.contains(active);
            const previous = previousFocusRef.current;
            if (shouldRestore && previous && document.contains(previous))
              previous.focus();
          }}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            handleCancel();
          }}
        >
          <button
            type="button"
            aria-label={backdropLabel}
            tabIndex={-1}
            className="absolute inset-0 size-full cursor-default border-0 bg-transparent p-0"
            onPointerDown={(event) => {
              event.preventDefault();
              dismissedOnPointerDownRef.current = true;
              handleCancel();
            }}
            onClick={() => {
              if (dismissedOnPointerDownRef.current) {
                dismissedOnPointerDownRef.current = false;
                return;
              }
              handleCancel();
            }}
          />
          <div
            data-app-modal-panel="true"
            data-state="open"
            data-overlay-size={size}
            className="crate-overlay-panel relative max-h-[92dvh] w-full overflow-y-auto"
          >
            <div className="relative px-5 py-4 pr-16">
              <div className="min-w-0">
                {eyebrow != null ? (
                  <MonoLabel size="eyebrow" className="mb-2">
                    {eyebrow}
                  </MonoLabel>
                ) : null}
                <AlertDialogPrimitive.Title
                  className={hasTitle ? "crate-overlay-title" : "sr-only"}
                >
                  {hasTitle ? title : ariaLabel}
                </AlertDialogPrimitive.Title>
              </div>
              <OverlayCloseButton
                className="absolute top-4 right-4"
                aria-label={closeLabel}
                disabled={pending}
                onClick={handleCancel}
              />
            </div>
            <div className="crate-overlay-body px-5 pb-4">
              <AlertDialogPrimitive.Description
                className={hasDescription ? "m-0" : "sr-only"}
              >
                {description}
              </AlertDialogPrimitive.Description>
              {body != null ? (
                <div className={description != null ? "mt-3" : undefined}>
                  {body}
                </div>
              ) : null}
              {consequence != null ? (
                <MonoLabel className="mt-4">{consequence}</MonoLabel>
              ) : null}
            </div>
            {confirmation ? (
              <div className="px-5 pb-5">
                <FormField id={confirmationId} label={confirmation.label}>
                  <Input
                    id={confirmationId}
                    value={confirmationValue}
                    disabled={pending}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) =>
                      setConfirmationValue(event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                  />
                </FormField>
              </div>
            ) : null}
            <div className="crate-overlay-footer flex flex-col-reverse gap-2 px-5 py-4 sm:flex-row sm:justify-end">
              <Button
                ref={cancelButtonRef}
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={handleCancel}
              >
                {cancelLabel}
              </Button>
              <Button
                ref={confirmButtonRef}
                type="button"
                variant={tone === "danger" ? "destructive" : "default"}
                disabled={pending || !confirmed}
                aria-busy={pending || undefined}
                data-tone={tone}
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
            </div>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
