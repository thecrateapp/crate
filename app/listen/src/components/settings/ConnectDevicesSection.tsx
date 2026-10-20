import { useSettingsPanelActive } from "./settings-panel-activity";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { notify } from "@crate/ui/lib/notify";
import { ConnectDevicesView } from "./ConnectDevicesView";

import { api } from "@/lib/api";
import {
  CRATE_CONNECT_FEATURE_ENABLED,
  CRATE_CONNECT_V2_TRANSPORT_ENABLED,
  setCrateConnectEnabled,
} from "@/lib/crate-connect";
import { useCrateConnectEnabled } from "@/hooks/use-crate-connect-enabled";
import {
  formatCrateAppPlatform,
  formatCrateDeviceName,
  formatCrateDeviceType,
  getListenDeviceId,
} from "@/lib/listen-device";
import { registerCurrentConnectDevice } from "@/lib/remote-playback-state";

interface ConnectDevice {
  device_id: string;
  device_label?: string | null;
  device_type?: string | null;
  app_platform?: string | null;
  app_version?: string | null;
  active: boolean;
  last_seen_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

interface ConnectDeviceListResponse {
  devices: ConnectDevice[];
}

const RECENT_DEVICE_WINDOW_MS = 5 * 60 * 1000;

function formatSeenAt(
  value: string | null | undefined,
  fallback: string,
): string {
  if (!value) return fallback;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return fallback;
  return new Date(timestamp).toLocaleString();
}

function deviceLabel(device: ConnectDevice): string {
  return formatCrateDeviceName(device);
}

function deviceMeta(device: ConnectDevice): string | null {
  const parts = [
    formatCrateAppPlatform(device.app_platform),
    formatCrateDeviceType(device.device_type),
  ].filter((part): part is string => Boolean(part));
  const uniqueParts = [...new Set(parts)];
  return uniqueParts.length > 0 ? uniqueParts.join(" · ") : null;
}

function deviceSeenTimestamp(device: ConnectDevice): number | null {
  const value = device.last_seen_at || device.updated_at || device.created_at;
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isVisibleDevice(
  device: ConnectDevice,
  currentDeviceId: string,
): boolean {
  if (device.device_id === currentDeviceId) return true;
  if (device.active) return true;
  const seenAt = deviceSeenTimestamp(device);
  return seenAt !== null && Date.now() - seenAt <= RECENT_DEVICE_WINDOW_MS;
}

export function ConnectDevicesSection() {
  if (!CRATE_CONNECT_FEATURE_ENABLED) return null;
  return <ConnectDevicesSectionContent />;
}

function ConnectDevicesSectionContent() {
  const panelActive = useSettingsPanelActive();
  const { t } = useTranslation();
  const currentDeviceId = useMemo(() => getListenDeviceId(), []);
  const connectEnabled = useCrateConnectEnabled();
  const [devices, setDevices] = useState<ConnectDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [readAttempt, setReadAttempt] = useState(0);
  const [forgettingDeviceId, setForgettingDeviceId] = useState<string | null>(
    null,
  );
  const [updatingPreference, setUpdatingPreference] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<ConnectDevice | null>(
    null,
  );
  useEffect(() => {
    if (!panelActive) setPendingRevoke(null);
  }, [panelActive]);
  const devicesRequestIdRef = useRef(0);
  const showLoadError = useEffectEvent(() => {
    notify.error(t("settings.connectDevices.toasts.loadFailed"));
  });

  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++devicesRequestIdRef.current;
    setLoading(true);
    setLoadError(false);
    api<ConnectDeviceListResponse>("/api/me/devices", "GET", undefined, {
      signal: controller.signal,
    })
      .then((response) => {
        if (requestId === devicesRequestIdRef.current) {
          setDevices(
            response.devices.filter((device) =>
              isVisibleDevice(device, currentDeviceId),
            ),
          );
        }
      })
      .catch((error) => {
        if (requestId !== devicesRequestIdRef.current) return;
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setLoadError(true);
        showLoadError();
      })
      .finally(() => {
        if (
          requestId === devicesRequestIdRef.current &&
          !controller.signal.aborted
        ) {
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
    };
  }, [currentDeviceId, readAttempt]);

  async function revokeDevice(device: ConnectDevice) {
    setForgettingDeviceId(device.device_id);
    try {
      await api(
        `/api/me/devices/${encodeURIComponent(device.device_id)}`,
        "DELETE",
      );
      setDevices((current) =>
        current.filter((item) => item.device_id !== device.device_id),
      );
      notify.success(t("settings.connectDevices.toasts.revoked"));
    } catch {
      notify.error(t("settings.connectDevices.toasts.revokeFailed"));
    } finally {
      setForgettingDeviceId(null);
    }
  }

  async function handleToggleConnect() {
    const nextEnabled = !connectEnabled;
    setUpdatingPreference(true);
    try {
      await setCrateConnectEnabled(nextEnabled);
      if (nextEnabled && !CRATE_CONNECT_V2_TRANSPORT_ENABLED) {
        void registerCurrentConnectDevice().catch(() => {});
      }
      notify.success(
        nextEnabled
          ? t("settings.connectDevices.toasts.enabled")
          : t("settings.connectDevices.toasts.disabled"),
      );
    } catch {
      notify.error(t("settings.connectDevices.toasts.updateFailed"));
    } finally {
      setUpdatingPreference(false);
    }
  }

  return (
    <>
      <ConnectDevicesView
        devices={devices.map((device) => ({
          id: device.device_id,
          label: deviceLabel(device),
          meta: deviceMeta(device),
          lastSeen: formatSeenAt(
            device.last_seen_at || device.updated_at || device.created_at,
            t("common.recently"),
          ),
          current: device.device_id === currentDeviceId,
          active: device.active,
        }))}
        loading={loading}
        error={loadError}
        enabled={connectEnabled}
        updating={updatingPreference}
        forgettingId={forgettingDeviceId}
        onToggle={() => void handleToggleConnect()}
        onRetry={() => setReadAttempt((value) => value + 1)}
        onRevoke={(id) =>
          setPendingRevoke(
            devices.find((device) => device.device_id === id) ?? null,
          )
        }
      />
      <ConfirmDialog
        eyebrow={t("actions.confirmation.eyebrow")}
        open={panelActive && pendingRevoke !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRevoke(null);
        }}
        onConfirm={async () => {
          if (pendingRevoke) await revokeDevice(pendingRevoke);
        }}
        tone="danger"
        title={t("settings.connectDevices.revokeConfirmTitle")}
        description={
          pendingRevoke
            ? t("settings.connectDevices.revokeConfirmDescription", {
                name: deviceLabel(pendingRevoke),
              })
            : undefined
        }
        confirmLabel={t("settings.connectDevices.revoke")}
        cancelLabel={t("common.cancel")}
        closeLabel={t("common.close")}
        ariaLabel={t("settings.connectDevices.revokeConfirmTitle")}
        backdropLabel={t("common.close")}
      />
    </>
  );
}
