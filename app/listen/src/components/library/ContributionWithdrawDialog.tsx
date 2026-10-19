import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";

export function ContributionWithdrawDialog({
  open,
  pending,
  title,
  body,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  pending: boolean;
  title: string;
  body: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      eyebrow={t("actions.confirmation.eyebrow")}
      open={open}
      tone="danger"
      pending={pending}
      title={title}
      body={body}
      confirmLabel={t("library.contributions.withdraw.confirm")}
      cancelLabel={t("common.keepIt")}
      closeLabel={t("common.close")}
      backdropLabel={t("common.closeDialog")}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
