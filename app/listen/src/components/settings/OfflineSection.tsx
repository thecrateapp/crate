import { ArtworkSurface } from "@/components/artwork/ArtworkSurface";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { notify } from "@crate/ui/lib/notify";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { ErrorState } from "@crate/ui/domain/states";
import { useOffline } from "@/contexts/OfflineContext";
import { formatBytes } from "@/lib/utils";
import { usesNativeFilesystem } from "@/lib/platform";
import { OfflineDownloadsView } from "./OfflineDownloadsView";
import { OfflineSettingsView } from "./OfflineSettingsView";
import { useSettingsOverlay } from "./settings-panel-activity";

export function OfflineSection({ ruled }: { ruled?: boolean } = {}) {
  const { t } = useTranslation();
  const {
    supported: offlineSupported,
    readOnly,
    items,
    syncing: offlineSyncing,
    summary: offlineSummary,
    syncAll,
    clearActiveProfile,
  } = useOffline();
  const [storageQuota, setStorageQuota] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useSettingsOverlay();
  const [clearPending, setClearPending] = useState(false);
  const [clearError, setClearError] = useState(false);
  const [clearScope, setClearScope] = useState({
    itemCount: 0,
    trackCount: 0,
    totalBytes: 0,
  });
  const clearing = useRef(false);
  const canWrite = offlineSupported && !readOnly && !offlineSyncing;
  const canManage = canWrite && offlineSummary.itemCount > 0;

  useEffect(() => {
    if (!canWrite || (!canManage && !clearPending && !clearError))
      setConfirmOpen(false);
  }, [canWrite, canManage, clearPending, clearError, setConfirmOpen]);

  function requestClear() {
    if (!canWrite || (!canManage && !clearError) || clearing.current) return;
    if (!clearError) {
      setClearScope({
        itemCount: offlineSummary.itemCount,
        trackCount: offlineSummary.trackCount,
        totalBytes: offlineSummary.totalBytes,
      });
    }
    setConfirmOpen(true);
  }

  async function confirmClear() {
    if (!canWrite || (!canManage && !clearError) || clearing.current) return;
    clearing.current = true;
    setClearPending(true);
    setClearError(false);
    try {
      await clearActiveProfile();
      notify.success(t("settings.offline.toasts.removed"));
    } catch (error) {
      setClearError(true);
      throw error;
    } finally {
      clearing.current = false;
      setClearPending(false);
    }
  }

  useEffect(() => {
    if (usesNativeFilesystem || !navigator.storage?.estimate) return;
    let disposed = false;
    void navigator.storage
      .estimate()
      .then(({ quota }) => {
        if (!disposed) {
          setStorageQuota(
            quota != null && Number.isFinite(quota) && quota > 0 ? quota : null,
          );
        }
      })
      .catch(() => {
        if (!disposed) setStorageQuota(null);
      });
    return () => {
      disposed = true;
    };
  }, [offlineSummary.totalBytes]);

  return (
    <>
      <OfflineSettingsView
        ruled={ruled}
        supported={offlineSupported}
        readOnly={readOnly}
        downloads={
          <OfflineDownloadsView
            items={items}
            renderImage={(image) => (
              <ArtworkSurface
                source={image.src}
                alt={image.alt}
                className={image.className}
                fallback={image.fallback}
                imageProps={{ onError: image.onError }}
              />
            )}
          />
        }
        syncing={offlineSyncing}
        clearing={clearPending}
        summary={offlineSummary}
        storageQuota={storageQuota}
        bytesText={formatBytes(offlineSummary.totalBytes)}
        quotaText={storageQuota != null ? formatBytes(storageQuota) : null}
        onSync={() => {
          if (!canManage || clearing.current) return;
          void syncAll()
            .then(() => notify.success(t("settings.offline.toasts.synced")))
            .catch((error: unknown) =>
              notify.error(
                (error as Error).message ||
                  t("settings.offline.toasts.syncFailed"),
              ),
            );
        }}
        onClear={requestClear}
      />
      {clearError && !confirmOpen ? (
        <ErrorState
          message={t("settings.offline.toasts.clearFailed")}
          retryLabel={t("common.retry")}
          onRetry={canWrite && !clearPending ? requestClear : undefined}
          className="mt-4"
        />
      ) : null}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={confirmClear}
        onError={() => setClearError(true)}
        pending={clearPending}
        tone="danger"
        title={t("settings.offline.removeConfirmTitle")}
        description={t("settings.offline.removeConfirmDescription", {
          itemCount: clearScope.itemCount,
          trackCount: clearScope.trackCount,
          size: formatBytes(clearScope.totalBytes),
        })}
        body={
          clearError ? (
            <p role="alert" className="text-state-danger-text">
              {t("settings.offline.toasts.clearFailed")}
            </p>
          ) : undefined
        }
        confirmLabel={t("settings.offline.removeConfirmAction")}
        cancelLabel={t("common.cancel")}
        closeLabel={t("common.close")}
        ariaLabel={t("settings.offline.removeConfirmTitle")}
        backdropLabel={t("common.close")}
      />
    </>
  );
}
