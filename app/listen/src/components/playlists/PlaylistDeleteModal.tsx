import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import type { TFunction } from "i18next";

export function PlaylistDeleteModal({
  deleting,
  name,
  onClose,
  onDelete,
  open,
  t,
}: {
  deleting: boolean;
  name: string;
  onClose: () => void;
  onDelete: () => void;
  open: boolean;
  t: TFunction;
}) {
  return (
    <ConfirmDialog
      open={open}
      tone="danger"
      pending={deleting}
      title={t("playlist.delete.title")}
      description={t("playlist.delete.subtitle")}
      body={
        <p>
          {t("playlist.delete.confirmPrefix")}{" "}
          <span className="font-medium text-text-primary">{name}</span>{" "}
          {t("playlist.delete.confirmSuffix")}
        </p>
      }
      confirmLabel={t("playlist.actions.deletePlaylist")}
      cancelLabel={t("common.cancel")}
      closeLabel={t("common.close")}
      onCancel={onClose}
      onConfirm={onDelete}
    />
  );
}
