import { ArtworkSurface } from "@/components/artwork/ArtworkSurface";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { notify } from "@crate/ui/lib/notify";
import { useOffline } from "@/contexts/OfflineContext";
import { formatBytes } from "@/lib/utils";
import { usesNativeFilesystem } from "@/lib/platform";
import { OfflineDownloadsView } from "./OfflineDownloadsView";
import { OfflineSettingsView } from "./OfflineSettingsView";

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
      summary={offlineSummary}
      storageQuota={storageQuota}
      bytesText={formatBytes(offlineSummary.totalBytes)}
      quotaText={storageQuota != null ? formatBytes(storageQuota) : null}
      onSync={() => {
        void syncAll()
          .then(() => notify.success(t("settings.offline.toasts.synced")))
          .catch((error: unknown) =>
            notify.error(
              (error as Error).message ||
                t("settings.offline.toasts.syncFailed"),
            ),
          );
      }}
      onClear={() => {
        void clearActiveProfile()
          .then(() => notify.success(t("settings.offline.toasts.removed")))
          .catch((error: unknown) =>
            notify.error(
              (error as Error).message ||
                t("settings.offline.toasts.clearFailed"),
            ),
          );
      }}
    />
  );
}
