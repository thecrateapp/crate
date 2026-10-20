import type { ReactNode } from "react";
import {
  AppModal,
  ModalBody,
  ModalFooter,
  type AppModalSize,
} from "@crate/ui/primitives/AppModal";
import { Button } from "@crate/ui/shadcn/button";

/** Shared Listen editor frame; controllers keep forms, pending state and mutations. */
export function CollectionEditorDialog({
  open,
  title,
  description,
  size = "lg",
  maxWidthClassName,
  formId,
  submitLabel,
  cancelLabel,
  closeLabel,
  pending = false,
  submitDisabled = false,
  closeBlocked = false,
  onCancel,
  children,
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  size?: AppModalSize;
  maxWidthClassName?: string;
  formId: string;
  submitLabel: string;
  cancelLabel: string;
  closeLabel: string;
  pending?: boolean;
  submitDisabled?: boolean;
  closeBlocked?: boolean;
  onCancel: () => void;
  children: ReactNode;
}) {
  const close = () => {
    if (!pending && !closeBlocked) onCancel();
  };
  return (
    <AppModal
      open={open}
      title={title}
      description={description}
      size={size}
      maxWidthClassName={maxWidthClassName}
      onClose={close}
      closeLabel={closeLabel}
      closeDisabled={pending}
      closeOnEscape={!pending && !closeBlocked}
      closeOnOverlay={!pending && !closeBlocked}
      panelClassName="flex min-h-0 flex-col"
    >
      <ModalBody className="min-h-0 flex-1 space-y-5 p-5">{children}</ModalBody>
      <ModalFooter className="flex items-center justify-end gap-3 px-5 py-4">
        <Button variant="ghost" disabled={pending} onClick={close}>
          {cancelLabel}
        </Button>
        <Button
          type="submit"
          form={formId}
          loading={pending}
          disabled={submitDisabled}
        >
          {submitLabel}
        </Button>
      </ModalFooter>
    </AppModal>
  );
}
