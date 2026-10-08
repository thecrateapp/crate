import { useTranslation } from "react-i18next";

import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";

export const CONTRIBUTION_EXPORT_CLASS_NAME =
  "min-h-10 border-border-quiet bg-transparent text-xs font-bold text-text-muted shadow-none hover:bg-text-primary/5";

export const CONTRIBUTION_WITHDRAW_CLASS_NAME =
  "size-10 border border-state-danger/20";

export function StatBox({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex-1 rounded-lg bg-text-primary/5 px-3 py-2.5 text-center">
      <div className="text-lg font-bold text-text-primary">{value ?? 0}</div>
      <div className="text-xs text-text-muted">{label}</div>
    </div>
  );
}

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
