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
      onClose={close}
      closeLabel={closeLabel}
      closeDisabled={pending}
      closeOnEscape={!pending && !closeBlocked}
      closeOnOverlay={!pending && !closeBlocked}
    >
      <ModalBody className="space-y-5 p-5">{children}</ModalBody>
      <ModalFooter>
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
