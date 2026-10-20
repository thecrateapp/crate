import type { ReactNode } from "react";
import { AppModal, ModalBody } from "@crate/ui/primitives/AppModal";
export function CollectionMembersDialog({
  open,
  title,
  description,
  closeLabel,
  onClose,
  closeBlocked = false,
  children,
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  closeLabel: string;
  onClose: () => void;
  closeBlocked?: boolean;
  children: ReactNode;
}) {
  return (
    <AppModal
      open={open}
      size="md"
      title={title}
      description={description}
      closeLabel={closeLabel}
      onClose={onClose}
      closeOnEscape={!closeBlocked}
    >
      <ModalBody className="space-y-5 p-5">{children}</ModalBody>
    </AppModal>
  );
}
