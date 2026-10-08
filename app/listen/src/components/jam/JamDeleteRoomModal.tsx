import type { TFunction } from "i18next";

import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import type { JamRoom } from "@/pages/jam-reducer";

export interface JamDeleteRoomModalProps {
  t: TFunction;
  deleteTargetRoom: JamRoom | null;
  deletingRoomId: string | null;
  setDeleteTargetRoom: (value: JamRoom | null) => void;
  confirmDeleteRoom: () => void | Promise<void>;
}

export function JamDeleteRoomModal({
  t,
  deleteTargetRoom,
  deletingRoomId,
  setDeleteTargetRoom,
  confirmDeleteRoom,
}: JamDeleteRoomModalProps) {
  return (
    <ConfirmDialog
      open={deleteTargetRoom !== null}
      onCancel={() => setDeleteTargetRoom(null)}
      onConfirm={confirmDeleteRoom}
      tone="danger"
      pending={Boolean(deletingRoomId)}
      title={t("jam.delete.modalTitle")}
      description={t("jam.delete.modalDescription")}
      body={
        <div className="jam-danger-panel rounded-lg px-4 py-3">
          <div className="text-sm font-medium text-text-primary">
            {deleteTargetRoom?.name || t("jam.delete.roomFallback")}
          </div>
          <div className="jam-danger-text mt-1 text-xs">
            {t("jam.delete.irreversible")}
          </div>
        </div>
      }
      confirmLabel={t("jam.delete.confirm")}
      cancelLabel={t("common.cancel")}
      closeLabel={t("common.close")}
      ariaLabel={t("jam.delete.modalTitle")}
      backdropLabel={t("common.close")}
    />
  );
}
