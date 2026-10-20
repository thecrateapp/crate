import { useTranslation } from "react-i18next";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { EntityRow } from "@crate/ui/domain/entity/EntityRow";
import { EmptyState, ErrorState, LoadingState } from "@crate/ui/domain/states";
import { Button } from "@crate/ui/shadcn/button";
import { CRATE_ICON_SIZE, MonitorSpeaker } from "@crate/ui/icons";
import { Section, ToggleRow } from "./SettingsPrimitives";
export interface ConnectDeviceViewItem {
  id: string;
  label: string;
  meta: string | null;
  lastSeen: string;
  current: boolean;
  active: boolean;
}
export function ConnectDevicesView({
  ruled,
  devices,
  loading,
  error,
  enabled,
  updating,
  forgettingId,
  onToggle,
  onRetry,
  onRevoke,
}: {
  ruled?: boolean;
  devices: ConnectDeviceViewItem[];
  loading: boolean;
  error: boolean;
  enabled: boolean;
  updating: boolean;
  forgettingId: string | null;
  onToggle: () => void;
  onRetry: () => void;
  onRevoke: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Section
      ruled={ruled}
      title={t("settings.connectDevices.title")}
      description={t("settings.connectDevices.description")}
    >
      <ToggleRow
        label={t("settings.connectDevices.title")}
        checked={enabled}
        disabled={updating}
        onChange={onToggle}
      />
      {error ? (
        <ErrorState
          message={t("settings.connectDevices.toasts.loadFailed")}
          onRetry={onRetry}
          retryLabel={t("common.retry")}
        />
      ) : null}
      {loading && !devices.length ? (
        <LoadingState label={t("settings.connectDevices.loading")} />
      ) : null}
      {!loading && !error && !devices.length ? (
        <EmptyState message={t("settings.connectDevices.empty")} />
      ) : null}
      {devices.length ? (
        <div>
          {devices.map((device) => (
            <EntityRow
              key={device.id}
              title={device.label}
              truncate={false}
              leading={
                <MonitorSpeaker size={CRATE_ICON_SIZE.md} aria-hidden="true" />
              }
              titleAccessory={
                <div className="flex flex-wrap gap-2">
                  {device.current ? (
                    <InfoBadge>{t("common.current")}</InfoBadge>
                  ) : null}
                  <InfoBadge tone={device.active ? "success" : "neutral"}>
                    {device.active ? t("common.active") : t("common.recent")}
                  </InfoBadge>
                </div>
              }
              subtitle={
                <span>
                  {t("settings.connectDevices.lastSeen", {
                    value: device.lastSeen,
                  })}
                </span>
              }
              meta={device.meta || undefined}
              trailing={
                <Button
                  variant="danger-soft"
                  aria-label={t("settings.connectDevices.revokeNamed", {
                    name: device.label,
                  })}
                  disabled={device.current}
                  loading={forgettingId === device.id}
                  onClick={() => onRevoke(device.id)}
                >
                  {t("settings.connectDevices.revoke")}
                </Button>
              }
            />
          ))}
        </div>
      ) : null}
    </Section>
  );
}
