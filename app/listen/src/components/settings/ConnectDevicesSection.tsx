import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, LogOut, MonitorSpeaker } from "lucide-react";
import { toast } from "sonner";

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

function formatSeenAt(value?: string | null): string {
  if (!value) return "recently";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "recently";
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
  const currentDeviceId = useMemo(() => getListenDeviceId(), []);
  const connectEnabled = useCrateConnectEnabled();
  const [devices, setDevices] = useState<ConnectDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [forgettingDeviceId, setForgettingDeviceId] = useState<string | null>(
    null,
  );
  const [updatingPreference, setUpdatingPreference] = useState(false);
  const devicesRequestIdRef = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++devicesRequestIdRef.current;
    setLoading(true);
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
        toast.error("Failed to load Crate Connect devices");
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
  }, [currentDeviceId]);

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
      toast.success("Device revoked");
    } catch {
      toast.error("Failed to revoke device");
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
      toast.success(
        nextEnabled ? "Crate Connect enabled" : "Crate Connect disabled",
      );
    } catch {
      toast.error("Failed to update Crate Connect");
    } finally {
      setUpdatingPreference(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl bg-white/5 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-medium text-foreground">
            Crate Connect devices
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Keep playback ownership explicit across your active devices.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={connectEnabled}
          disabled={updatingPreference}
          onClick={() => void handleToggleConnect()}
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
            connectEnabled
              ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-200"
              : "border-white/10 bg-white/5 text-white/55"
          } disabled:cursor-wait disabled:opacity-70`}
        >
          {updatingPreference ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <span
              className={`h-2 w-2 rounded-full ${
                connectEnabled ? "bg-cyan-300" : "bg-white/35"
              }`}
            />
          )}
          {connectEnabled ? "Enabled" : "Disabled"}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          Loading devices...
        </div>
      ) : (
        <div className="space-y-2">
          {devices.map((device) => {
            const isCurrent = device.device_id === currentDeviceId;
            const lastSeen =
              device.last_seen_at || device.updated_at || device.created_at;
            const label = deviceLabel(device);
            const meta = deviceMeta(device);
            const busy = forgettingDeviceId === device.device_id;
            return (
              <div
                key={device.device_id}
                className="flex items-start justify-between gap-4 rounded-lg border border-white/10 px-3 py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                      <MonitorSpeaker
                        size={14}
                        className="text-muted-foreground"
                      />
                      <span className="truncate">{label}</span>
                    </div>
                    {isCurrent ? (
                      <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[11px] font-medium text-cyan-300">
                        Current
                      </span>
                    ) : null}
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                        device.active
                          ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                          : "border-white/10 bg-white/5 text-white/50"
                      }`}
                    >
                      {device.active ? "Active" : "Recent"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Last seen {formatSeenAt(lastSeen)}
                  </div>
                  {meta ? (
                    <div className="mt-1 text-[11px] text-white/40">{meta}</div>
                  ) : null}
                </div>
                <button
                  type="button"
                  aria-label={`Revoke ${label}`}
                  disabled={busy || isCurrent}
                  onClick={() => void revokeDevice(device)}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <LogOut size={13} />
                  )}
                  Revoke device
                </button>
              </div>
            );
          })}
          {devices.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No active Crate Connect devices right now.
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
