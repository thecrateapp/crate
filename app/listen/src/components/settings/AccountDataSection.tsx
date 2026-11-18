import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { notify } from "@crate/ui/lib/notify";
import { FormField } from "@crate/ui/primitives/FormField";
import { Input } from "@crate/ui/shadcn/input";

import {
  AccountDataView,
  type AccountExportStatus,
} from "@/components/settings/AccountDataView";
import { useAuth } from "@/contexts/AuthContext";
import { api, ensureMediaAccessUrl } from "@/lib/api";
import { useSettingsOverlay } from "./settings-panel-activity";

const EXPORT_URL = "/api/me/export";
const DELETION_URL = "/api/me/account/deletion";
const ACCOUNT_URL = "/api/me";
export const EXPORT_POLL_INTERVAL_MS = 3000;
const DEFAULT_REAUTH_WINDOW_SECONDS = 600;

export interface UserDataExport {
  id: string;
  status: "pending" | "ready" | "failed" | "expired";
  created_at: string;
  expires_at?: string | null;
  download_url?: string | null;
}

interface UserDataExportStatus {
  export?: UserDataExport | null;
}

interface DeletionRequirements {
  requires_password?: boolean;
  recent_sign_in?: boolean;
  recent_sign_in_window_seconds?: number;
}

class PasswordRequiredError extends Error {}

function errorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

export function AccountDataSection() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const passwordId = useId();
  const [exportInfo, setExportInfo] = useState<UserDataExport | null>(null);
  const [exportLoaded, setExportLoaded] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requirements, setRequirements] = useState<DeletionRequirements>({});
  const [confirmOpen, setConfirmOpen] = useSettingsOverlay();
  const [password, setPassword] = useState("");

  useEffect(() => {
    let active = true;
    setExportLoaded(false);
    api<UserDataExportStatus>(EXPORT_URL)
      .then((response) => {
        if (active) setExportInfo(response?.export ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setExportLoaded(true);
      });
    api<DeletionRequirements>(DELETION_URL)
      .then((response) => {
        if (active) setRequirements(response ?? {});
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user?.id]);

  const exportPending = exportInfo?.status === "pending";
  useEffect(() => {
    if (!exportPending) return;
    const timer = window.setInterval(() => {
      api<UserDataExportStatus>(EXPORT_URL)
        .then((response) => setExportInfo(response?.export ?? null))
        .catch(() => {});
    }, EXPORT_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [exportPending]);

  useEffect(() => {
    if (!confirmOpen) setPassword("");
  }, [confirmOpen]);

  const exportStatus: AccountExportStatus = !exportLoaded
    ? "loading"
    : (exportInfo?.status ?? "none");
  const requiresPassword = requirements.requires_password !== false;
  const deletionAvailable =
    requiresPassword || requirements.recent_sign_in === true;
  const windowMinutes = Math.round(
    (requirements.recent_sign_in_window_seconds ??
      DEFAULT_REAUTH_WINDOW_SECONDS) / 60,
  );

  async function handleRequestExport() {
    setRequesting(true);
    try {
      const response = await api<UserDataExport>(EXPORT_URL, "POST");
      setExportInfo(response);
      notify.success(t("settings.account.export.toasts.requested"));
    } catch {
      notify.error(t("settings.account.export.toasts.requestFailed"));
    } finally {
      setRequesting(false);
    }
  }

  async function handleDownloadExport() {
    const downloadUrl = exportInfo?.download_url;
    if (!downloadUrl) return;
    try {
      const url = await ensureMediaAccessUrl(downloadUrl, "artwork");
      window.location.assign(url);
    } catch {
      notify.error(t("settings.account.export.toasts.downloadFailed"));
    }
  }

  async function confirmDeletion() {
    if (requiresPassword && !password) throw new PasswordRequiredError();
    await api(ACCOUNT_URL, "DELETE", requiresPassword ? { password } : {});
    notify.success(t("settings.account.delete.toasts.deleted"));
    await logout();
  }

  function handleDeletionError(error: unknown) {
    const status = errorStatus(error);
    const key =
      error instanceof PasswordRequiredError
        ? "settings.account.delete.toasts.passwordRequired"
        : status === 409
          ? "settings.account.delete.toasts.lastAdmin"
          : status === 429
            ? "settings.account.delete.toasts.tooManyAttempts"
            : status === 403 && requiresPassword
              ? "settings.account.delete.toasts.incorrectPassword"
              : status === 403
                ? "settings.account.delete.toasts.signInAgain"
                : "settings.account.delete.toasts.failed";
    notify.error(t(key, { minutes: windowMinutes }));
  }

  return (
    <>
      <AccountDataView
        exportStatus={exportStatus}
        exportExpiresAt={exportInfo?.expires_at}
        exportBusy={requesting}
        onRequestExport={() => void handleRequestExport()}
        onDownloadExport={() => void handleDownloadExport()}
        deletionRequiresPassword={requiresPassword}
        deletionAvailable={deletionAvailable}
        deletionWindowMinutes={windowMinutes}
        onDeleteAccount={() => setConfirmOpen(true)}
      />
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={confirmDeletion}
        onError={handleDeletionError}
        tone="danger"
        title={t("settings.account.delete.confirmTitle")}
        description={t("settings.account.delete.confirmDescription")}
        body={
          requiresPassword ? (
            <FormField
              id={passwordId}
              label={t("settings.account.delete.password")}
            >
              <Input
                id={passwordId}
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
              />
            </FormField>
          ) : undefined
        }
        confirmLabel={t("settings.account.delete.confirmAction")}
        cancelLabel={t("common.cancel")}
        closeLabel={t("common.close")}
        ariaLabel={t("settings.account.delete.confirmTitle")}
        backdropLabel={t("common.close")}
      />
    </>
  );
}
