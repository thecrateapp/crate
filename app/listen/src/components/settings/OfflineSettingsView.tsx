import type { ReactNode } from "react";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { useTranslation } from "react-i18next";
import { Meter } from "@crate/ui/primitives/Meter";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { StatNumber } from "@crate/ui/primitives/StatNumber";

import { CRATE_ICON_SIZE, RefreshCw, Trash2 } from "@crate/ui/icons";
import { Button } from "@crate/ui/shadcn/button";

import { Section } from "./SettingsPrimitives";
interface OfflineSettingsViewProps {
  ruled?: boolean;
  supported: boolean;
  readOnly?: boolean;
  downloads?: ReactNode;
  syncing: boolean;
  clearing?: boolean;
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
  ruled,
  supported: offlineSupported,
  readOnly = false,
  downloads,
  syncing: offlineSyncing,
  clearing = false,
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
      ruled={ruled}
      title={t("settings.offline.title")}
      description={t("settings.offline.subtitle")}
    >
      <div className="grid min-w-0 gap-6 @min-[40rem]:grid-cols-3">
        <div>
          <StatNumber
            value={offlineSummary.itemCount}
            label={t("settings.offline.items")}
            size="md"
          />
          <MonoLabel className="mt-2">
            {t("settings.offline.readyItems", {
              count: offlineSummary.readyItemCount,
            })}
            {offlineSummary.errorItemCount
              ? ` · ${t("settings.offline.needsAttention", {
                  count: offlineSummary.errorItemCount,
                })}`
              : ""}
          </MonoLabel>
        </div>
        <div>
          <Meter
            label={t("common.tracks")}
            value={offlineSummary.readyTrackCount}
            max={offlineSummary.trackCount}
            valueText={`${offlineSummary.readyTrackCount}/${offlineSummary.trackCount}`}
          />
          <MonoLabel className="mt-2">
            {t("settings.offline.mirrored")}
          </MonoLabel>
        </div>
        <div>
          {storageQuota != null ? (
            <Meter
              label={t("settings.offline.storage")}
              value={offlineSummary.totalBytes}
              max={storageQuota}
              over={offlineSummary.totalBytes > storageQuota}
              valueText={`${bytesText} / ${quotaText}`}
            />
          ) : (
            <StatNumber
              value={bytesText}
              label={t("settings.offline.storage")}
              size="sm"
            />
          )}
          <MonoLabel className="mt-2">
            {t("settings.offline.footprint")}
          </MonoLabel>
        </div>
      </div>

      {downloads}

      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          disabled={
            !offlineSupported ||
            readOnly ||
            offlineSyncing ||
            clearing ||
            offlineSummary.itemCount === 0
          }
          onClick={onSync}
          loading={offlineSyncing}
        >
          {!offlineSyncing ? (
            <RefreshCw size={CRATE_ICON_SIZE.sm} aria-hidden="true" />
          ) : null}
          {t("settings.offline.syncNow")}
        </Button>
        <Button
          variant="danger-soft"
          disabled={
            !offlineSupported ||
            readOnly ||
            offlineSyncing ||
            clearing ||
            offlineSummary.itemCount === 0
          }
          onClick={onClear}
          loading={clearing}
        >
          {!clearing ? (
            <Trash2 size={CRATE_ICON_SIZE.sm} aria-hidden="true" />
          ) : null}
          {t("settings.offline.removeCopies")}
        </Button>
      </div>

      <p className="flex items-start gap-3 text-caption text-text-muted">
        <StatusDot tone={offlineSupported ? "off" : "warn"} />
        <span>
          {!offlineSupported
            ? t("settings.offline.unavailable")
            : readOnly
              ? t("settings.offline.readOnly")
              : t("settings.offline.localMirrorDescription")}
        </span>
      </p>
    </Section>
  );
}
