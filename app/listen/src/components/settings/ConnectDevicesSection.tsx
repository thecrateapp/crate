import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MonitorSpeaker, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import {
  CRATE_CONNECT_FEATURE_ENABLED,
  setCrateConnectEnabled,
} from "@/lib/crate-connect";
import { useCrateConnectEnabled } from "@/hooks/use-crate-connect-enabled";
import { getListenDeviceId } from "@/lib/listen-device";
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

function formatSeenAt(value?: string | null): string {
  if (!value) return "recently";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "recently";
  return new Date(timestamp).toLocaleString();
}

function deviceLabel(device: ConnectDevice): string {
  return device.device_label || device.app_platform || device.device_id;
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
          setDevices(response.devices);
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
  }, []);

  async function forgetDevice(device: ConnectDevice) {
    setForgettingDeviceId(device.device_id);
    try {
      await api(
        `/api/me/devices/${encodeURIComponent(device.device_id)}`,
        "DELETE",
      );
      setDevices((current) =>
        current.filter((item) => item.device_id !== device.device_id),
      );
      toast.success("Device forgotten");
    } catch {
      toast.error("Failed to forget device");
    } finally {
      setForgettingDeviceId(null);
    }
  }

  async function handleToggleConnect() {
    const nextEnabled = !connectEnabled;
    setUpdatingPreference(true);
    try {
      await setCrateConnectEnabled(nextEnabled);
      if (nextEnabled) void registerCurrentConnectDevice().catch(() => {});
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
                  {device.app_platform || device.device_type ? (
                    <div className="mt-1 text-[11px] text-white/40">
                      {[device.app_platform, device.device_type]
                        .filter(Boolean)
                        .join(" - ")}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  aria-label={`Forget ${label}`}
                  disabled={busy || isCurrent}
                  onClick={() => void forgetDevice(device)}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Trash2 size={13} />
                  )}
                  Forget
                </button>
              </div>
            );
          })}
          {devices.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No Crate Connect devices yet.
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
