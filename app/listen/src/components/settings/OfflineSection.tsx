import { useTranslation } from "react-i18next";
import { notify } from "@crate/ui/lib/notify";

import {
  ArrowDownToLine,
  CRATE_ICON_SIZE,
  Loader2,
  RefreshCw,
  Trash2,
} from "@crate/ui/icons";
import { Button } from "@crate/ui/shadcn/button";

import { Section } from "@/components/settings/SettingsPrimitives";
import { useOffline } from "@/contexts/OfflineContext";
import { formatBytes } from "@/lib/utils";

export function OfflineSection() {
  const { t } = useTranslation();
  const {
    supported: offlineSupported,
    syncing: offlineSyncing,
    summary: offlineSummary,
    syncAll,
    clearActiveProfile,
  } = useOffline();

  return (
    <Section
      title={t("settings.offline.title")}
      description={t("settings.offline.subtitle")}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border-quiet/10 bg-text-primary/[0.03] p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-text-primary/40">
            {t("settings.offline.items")}
          </div>
          <div className="mt-2 text-2xl font-semibold text-text-primary">
            {offlineSummary.itemCount}
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {t("settings.offline.readyItems", {
              count: offlineSummary.readyItemCount,
            })}
            {offlineSummary.errorItemCount
              ? ` · ${t("settings.offline.needsAttention", {
                  count: offlineSummary.errorItemCount,
                })}`
              : ""}
          </p>
        </div>
        <div className="rounded-xl border border-border-quiet/10 bg-text-primary/[0.03] p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-text-primary/40">
            {t("common.tracks")}
          </div>
          <div className="mt-2 text-2xl font-semibold text-text-primary">
            {offlineSummary.readyTrackCount}/{offlineSummary.trackCount}
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {t("settings.offline.mirrored")}
          </p>
        </div>
        <div className="rounded-xl border border-border-quiet/10 bg-text-primary/[0.03] p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-text-primary/40">
            {t("settings.offline.storage")}
          </div>
          <div className="mt-2 text-2xl font-semibold text-text-primary">
            {formatBytes(offlineSummary.totalBytes)}
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {t("settings.offline.footprint")}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          disabled={
            !offlineSupported ||
            offlineSyncing ||
            offlineSummary.itemCount === 0
          }
          onClick={() => {
            void syncAll()
              .then(() => {
                notify.success(t("settings.offline.toasts.synced"));
              })
              .catch((error) => {
                notify.error(
                  (error as Error).message ||
                    t("settings.offline.toasts.syncFailed"),
                );
              });
          }}
          className="h-auto rounded-lg border border-accent-action/30 bg-accent-action/10 px-4 py-2 text-accent-action hover:bg-accent-action/15 has-[>svg]:px-4"
        >
          {offlineSyncing ? (
            <Loader2
              size={CRATE_ICON_SIZE.sm}
              className="size-4 animate-spin"
            />
          ) : (
            <RefreshCw size={CRATE_ICON_SIZE.sm} className="size-4" />
          )}
          {t("settings.offline.syncNow")}
        </Button>
        <Button
          variant="danger-soft"
          disabled={
            !offlineSupported ||
            offlineSyncing ||
            offlineSummary.itemCount === 0
          }
          onClick={() => {
            void clearActiveProfile()
              .then(() => {
                notify.success(t("settings.offline.toasts.removed"));
              })
              .catch((error) => {
                notify.error(
                  (error as Error).message ||
                    t("settings.offline.toasts.clearFailed"),
                );
              });
          }}
          className="h-auto rounded-lg px-4 py-2 text-state-danger has-[>svg]:px-4"
        >
          <Trash2 size={CRATE_ICON_SIZE.sm} className="size-4" />
          {t("settings.offline.removeCopies")}
        </Button>
      </div>

      <div className="rounded-lg border border-border-quiet/10 bg-text-primary/[0.03] px-4 py-3 text-sm text-text-muted">
        <div className="flex items-start gap-3">
          <ArrowDownToLine size={16} className="mt-0.5 text-text-primary/50" />
          <div>
            {offlineSupported
              ? t("settings.offline.localMirrorDescription")
              : t("settings.offline.unavailable")}
          </div>
        </div>
      </div>
    </Section>
  );
}
