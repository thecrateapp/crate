import { useTranslation } from "react-i18next";
import { Meter } from "@crate/ui/primitives/Meter";
import { StatNumber } from "@crate/ui/primitives/StatNumber";

import {
  ArrowDownToLine,
  CRATE_ICON_SIZE,
  Loader2,
  RefreshCw,
  Trash2,
} from "@crate/ui/icons";
import { Button } from "@crate/ui/shadcn/button";

import { Section } from "./SettingsPrimitives";
interface OfflineSettingsViewProps {
  supported: boolean;
  syncing: boolean;
  summary: {
    itemCount: number;
    readyItemCount: number;
    errorItemCount: number;
    trackCount: number;
    readyTrackCount: number;
    totalBytes: number;
  };
  storageQuota: number | null;
  bytesText: string;
  quotaText: string | null;
  onSync: () => void;
  onClear: () => void;
}
export function OfflineSettingsView({
  supported: offlineSupported,
  syncing: offlineSyncing,
  summary: offlineSummary,
  storageQuota,
  bytesText,
  quotaText,
  onSync,
  onClear,
}: OfflineSettingsViewProps) {
  const { t } = useTranslation();
  return (
    <Section
      title={t("settings.offline.title")}
      description={t("settings.offline.subtitle")}
    >
      <div className="space-y-5">
        <div>
          <StatNumber
            value={offlineSummary.itemCount}
            label={t("settings.offline.items")}
            size="md"
          />
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
        <div>
          <Meter
            label={t("common.tracks")}
            value={offlineSummary.readyTrackCount}
            max={offlineSummary.trackCount}
            valueText={`${offlineSummary.readyTrackCount}/${offlineSummary.trackCount}`}
          />
          <p className="mt-1 text-xs text-text-muted">
            {t("settings.offline.mirrored")}
          </p>
        </div>
        <div>
          {storageQuota != null ? (
            <Meter
              label={t("settings.offline.storage")}
              value={offlineSummary.totalBytes}
              max={storageQuota}
              over={offlineSummary.totalBytes > storageQuota}
              valueText={`${bytesText} / ${quotaText}`}
              thickness={3}
            />
          ) : (
            <>
              <div className="text-xs uppercase tracking-eyebrow-wide text-text-primary/40">
                {t("settings.offline.storage")}
              </div>
              <div className="mt-2 text-2xl font-semibold text-text-primary">
                {bytesText}
              </div>
            </>
          )}
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
          onClick={onSync}
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
          onClick={onClear}
          className="h-auto rounded-lg px-4 py-2 text-state-danger has-[>svg]:px-4"
        >
          <Trash2 size={CRATE_ICON_SIZE.sm} className="size-4" />
          {t("settings.offline.removeCopies")}
        </Button>
      </div>

      <div className="rounded-lg border border-border-quiet/10 bg-text-primary/[0.03] px-4 py-3 text-sm text-text-muted">
        <div className="flex items-start gap-3">
          <ArrowDownToLine
            size={CRATE_ICON_SIZE.sm}
            className="mt-0.5 text-text-primary/50"
          />
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
