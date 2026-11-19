import { useTranslation } from "react-i18next";

import { CRATE_ICON_SIZE, Download, Trash2 } from "@crate/ui/icons";
import { FormField } from "@crate/ui/primitives/FormField";
import { Button } from "@crate/ui/shadcn/button";

export type AccountExportStatus =
  "loading" | "none" | "pending" | "ready" | "failed" | "expired";

export interface AccountDataViewProps {
  exportStatus: AccountExportStatus;
  exportExpiresAt?: string | null;
  exportBusy?: boolean;
  onRequestExport: () => void;
  onDownloadExport: () => void;
  deletionRequiresPassword: boolean;
  deletionAvailable: boolean;
  deletionWindowMinutes: number;
  onDeleteAccount: () => void;
}

/** Export and deletion controls shared by the production controller and isolated review. */
export function AccountDataView({
  exportStatus,
  exportExpiresAt,
  exportBusy = false,
  onRequestExport,
  onDownloadExport,
  deletionRequiresPassword,
  deletionAvailable,
  deletionWindowMinutes,
  onDeleteAccount,
}: AccountDataViewProps) {
  const { t, i18n } = useTranslation();
  const expiresLabel = exportExpiresAt
    ? new Intl.DateTimeFormat(i18n.language, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(exportExpiresAt))
    : null;
  const statusMessage =
    exportStatus === "pending"
      ? t("settings.account.export.pending")
      : exportStatus === "ready" && expiresLabel
        ? t("settings.account.export.ready", { date: expiresLabel })
        : exportStatus === "failed"
          ? t("settings.account.export.failed")
          : exportStatus === "expired"
            ? t("settings.account.export.expired")
            : null;
  const requestDisabled =
    exportBusy || exportStatus === "loading" || exportStatus === "pending";

  return (
    <div className="grid min-w-0 gap-5 @min-[36rem]:grid-cols-2">
      <FormField kind="group" label={t("settings.account.export.title")}>
        {(field) => (
          <div {...field} role="group" className="grid content-start gap-3">
            <p className="text-caption text-text-muted">
              {t("settings.account.export.description")}
            </p>
            {statusMessage ? (
              <p
                role="status"
                className={
                  exportStatus === "failed"
                    ? "text-caption text-state-danger-text"
                    : "text-caption text-text-muted"
                }
              >
                {statusMessage}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {exportStatus === "ready" ? (
                <Button type="button" onClick={onDownloadExport}>
                  <Download size={CRATE_ICON_SIZE.xs} />
                  {t("settings.account.export.download")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant={exportStatus === "ready" ? "ghost" : "default"}
                disabled={requestDisabled}
                onClick={onRequestExport}
              >
                {exportStatus === "pending"
                  ? t("settings.account.export.preparing")
                  : exportStatus === "ready"
                    ? t("settings.account.export.requestAgain")
                    : t("settings.account.export.request")}
              </Button>
            </div>
          </div>
        )}
      </FormField>
      <FormField kind="group" label={t("settings.account.delete.title")}>
        {(field) => (
          <div {...field} role="group" className="grid content-start gap-3">
            <p className="text-caption text-text-muted">
              {t("settings.account.delete.description")}
            </p>
            {!deletionRequiresPassword && !deletionAvailable ? (
              <p role="status" className="text-caption text-text-muted">
                {t("settings.account.delete.recentSignInRequired", {
                  minutes: deletionWindowMinutes,
                })}
              </p>
            ) : null}
            <div>
              <Button
                type="button"
                variant="danger-soft"
                disabled={!deletionAvailable}
                onClick={onDeleteAccount}
              >
                <Trash2 size={CRATE_ICON_SIZE.xs} />
                {t("settings.account.delete.action")}
              </Button>
            </div>
          </div>
        )}
      </FormField>
    </div>
  );
}
