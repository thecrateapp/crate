import type { Track } from "@/contexts/player-types";
import { getCastSenderCapabilities, startCastSession } from "@/lib/cast-sender";
import {
  CRATE_CONNECT_V2_TRANSPORT_ENABLED,
  fetchActiveConnectSession,
  fetchConnectDevices,
  isCrateConnectEnabled,
  transferPlaybackToDevice,
  type ActiveConnectSession,
  type ConnectDevice,
} from "@/lib/crate-connect";
import {
  formatCrateDeviceName,
  getListenDeviceCapabilities,
  getListenDeviceId,
  getListenDeviceLabel,
} from "@/lib/listen-device";
import {
  getNativeCurrentOutputRoute,
  getNativeOutputCapabilities,
  isNativeOutputRoutingAvailable,
  showNativeOutputPicker,
} from "@/lib/native-output-router";

export type PlaybackTargetKind =
  | "airplay"
  | "crate-device"
  | "google-cast"
  | "local"
  | "system-route";

export interface PlaybackTargetCapabilities {
  canPlay: boolean;
  canSeek: boolean;
  canSetVolume: boolean;
  canShowSystemPicker?: boolean;
}

export interface PlaybackTarget {
  id: string;
  providerId: string;
  kind: PlaybackTargetKind;
  name: string;
  subtitle?: string;
  active: boolean;
  available: boolean;
  unavailableReason?: string;
  capabilities: PlaybackTargetCapabilities;
}

export interface PlaybackTargetSelectionResult {
  ok: boolean;
  message?: string;
}

export interface PlaybackTargetContext {
  currentTrack?: Track | null;
  currentTime?: number;
  currentIndex?: number;
  queue?: Track[];
  volume?: number;
  activeConnectDeviceId?: string | null;
  activeConnectSession?: ActiveConnectSession | null;
  connect?: PlaybackTargetConnectContext | null;
  pause?: () => void | Promise<void>;
  publishConnectState?: (options?: { claimActive?: boolean }) => Promise<void>;
}

export interface PlaybackTargetConnectInstance {
  instance_id: string;
  device_id?: string | null;
  device_label?: string | null;
  device_type?: string | null;
  app_platform?: string | null;
  connected_at?: string | null;
  capabilities?: Record<string, unknown> | null;
}

export interface PlaybackTargetConnectContext {
  activeInstanceId: string | null;
  connectedInstances: PlaybackTargetConnectInstance[];
  playbackInstanceId: string | null;
  requestTransfer: (targetInstanceId: string) => boolean;
  transport: "legacy" | "ws" | null;
}

export interface PlaybackTargetProvider {
  id: string;
  label: string;
  getTargets: (
    context?: PlaybackTargetContext,
  ) => PlaybackTarget[] | Promise<PlaybackTarget[]>;
  selectTarget: (
    target: PlaybackTarget,
    context?: PlaybackTargetContext,
  ) => PlaybackTargetSelectionResult | Promise<PlaybackTargetSelectionResult>;
}

export interface PlaybackTargetGroup {
  providerId: string;
  label: string;
  targets: PlaybackTarget[];
  error?: string;
}

function connectDeviceName(device: ConnectDevice): string {
  return formatCrateDeviceName(device);
}

function connectDeviceUnavailableReason(device: ConnectDevice): string {
  if (device.capabilities?.can_play === false) {
    return "Playback is not available on this device.";
  }
  if (device.capabilities?.can_receive_commands !== true) {
    return "This device cannot receive transfer commands yet.";
  }
  return "Crate Connect transfer is unavailable.";
}

function isLegacyCrateConnectEnabled(): boolean {
  return isCrateConnectEnabled() && !CRATE_CONNECT_V2_TRANSPORT_ENABLED;
}

function isWsCrateConnectContext(
  context?: PlaybackTargetContext,
): context is PlaybackTargetContext & {
  connect: PlaybackTargetConnectContext;
} {
  return context?.connect?.transport === "ws";
}

function capabilityFlag(
  capabilities: Record<string, unknown> | null | undefined,
  key: string,
  fallback: boolean,
): boolean {
  const value = capabilities?.[key];
  return typeof value === "boolean" ? value : fallback;
}

function connectInstanceName(instance: PlaybackTargetConnectInstance): string {
  return formatCrateDeviceName(instance);
}

function visibleInstanceNames(
  instances: PlaybackTargetConnectInstance[],
): Map<string, string> {
  const totals = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const instance of instances) {
    const name = connectInstanceName(instance);
    totals.set(name, (totals.get(name) ?? 0) + 1);
  }
  const names = new Map<string, string>();
  for (const instance of instances) {
    const name = connectInstanceName(instance);
    const total = totals.get(name) ?? 1;
    const index = (seen.get(name) ?? 0) + 1;
    seen.set(name, index);
    names.set(instance.instance_id, total > 1 ? `${name} (${index})` : name);
  }
  return names;
}

export const localTargetProvider: PlaybackTargetProvider = {
  id: "local",
  label: "This device",
  getTargets: (context) => {
    const capabilities = getListenDeviceCapabilities();
    const activeConnectDeviceId = context?.activeConnectDeviceId;
    const localActive = isWsCrateConnectContext(context)
      ? !context.connect.activeInstanceId ||
        context.connect.activeInstanceId === context.connect.playbackInstanceId
      : !activeConnectDeviceId || activeConnectDeviceId === getListenDeviceId();
    return [
      {
        id: "local:current",
        providerId: "local",
        kind: "local",
        name: getListenDeviceLabel(),
        subtitle: localActive
          ? "System-selected output"
          : "Available on this device",
        active: localActive,
        available: true,
        capabilities: {
          canPlay: capabilities.can_play,
          canSeek: true,
          canSetVolume: capabilities.can_set_volume,
          canShowSystemPicker: false,
        },
      },
    ];
  },
  selectTarget: async (_target, context) => {
    if (isWsCrateConnectContext(context)) {
      const { activeInstanceId, playbackInstanceId, requestTransfer } =
        context.connect;
      if (
        playbackInstanceId &&
        activeInstanceId &&
        activeInstanceId !== playbackInstanceId
      ) {
        const sent = requestTransfer(playbackInstanceId);
        return sent
          ? { ok: true, message: "Playing here." }
          : { ok: false, message: "Crate Connect is still connecting." };
      }
      return {
        ok: true,
        message: "Already playing on this device.",
      };
    }
    if (!isLegacyCrateConnectEnabled()) {
      return {
        ok: true,
        message: "Already playing on this device.",
      };
    }
    const currentDeviceId = getListenDeviceId();
    const freshSession = await fetchActiveConnectSession().catch(() => null);
    const activeDeviceId =
      freshSession?.active_device_id || context?.activeConnectDeviceId;
    if (activeDeviceId && activeDeviceId !== currentDeviceId) {
      await transferPlaybackToDevice(currentDeviceId, {
        sourceDeviceId: activeDeviceId,
        startPlaying: true,
      });
      return { ok: true, message: "Playing here." };
    }
    return {
      ok: true,
      message: "Already playing on this device.",
    };
  },
};

export const crateConnectTargetProvider: PlaybackTargetProvider = {
  id: "crate-connect",
  label: "Crate devices",
  getTargets: async (context) => {
    if (isWsCrateConnectContext(context)) {
      const { activeInstanceId, connectedInstances, playbackInstanceId } =
        context.connect;
      const instances = connectedInstances.filter(
        (instance) => instance.instance_id !== playbackInstanceId,
      );
      const names = visibleInstanceNames(instances);
      return instances.map((instance) => {
        const canPlay = capabilityFlag(instance.capabilities, "can_play", true);
        const active = activeInstanceId === instance.instance_id;
        return {
          id: `crate-instance:${instance.instance_id}`,
          providerId: "crate-connect",
          kind: "crate-device" as const,
          name:
            names.get(instance.instance_id) ?? connectInstanceName(instance),
          subtitle: active
            ? "Playing through Crate Connect"
            : "Connected Crate instance",
          active,
          available: canPlay,
          unavailableReason: canPlay
            ? undefined
            : "Playback is not available on this instance.",
          capabilities: {
            canPlay,
            canSeek: canPlay,
            canSetVolume: capabilityFlag(
              instance.capabilities,
              "can_set_volume",
              true,
            ),
          },
        };
      });
    }
    if (!isLegacyCrateConnectEnabled()) return [];
    const currentDeviceId = getListenDeviceId();
    const activeConnectDeviceId = context?.activeConnectDeviceId;
    const response = await fetchConnectDevices();
    return response.devices.reduce<PlaybackTarget[]>((targets, device) => {
      if (device.device_id === currentDeviceId) return targets;
      const available =
        device.capabilities?.can_play !== false &&
        device.capabilities?.can_receive_commands === true;
      const active = activeConnectDeviceId === device.device_id;
      targets.push({
        id: `crate:${device.device_id}`,
        providerId: "crate-connect",
        kind: "crate-device" as const,
        name: connectDeviceName(device),
        subtitle: active
          ? "Playing through Crate Connect"
          : device.active
            ? "Active Crate device"
            : "Recent Crate device",
        active,
        available,
        unavailableReason: available
          ? undefined
          : connectDeviceUnavailableReason(device),
        capabilities: {
          canPlay: device.capabilities?.can_play !== false,
          canSeek: available,
          canSetVolume: device.capabilities?.can_set_volume === true,
        },
      });
      return targets;
    }, []);
  },
  selectTarget: async (target, context) => {
    if (isWsCrateConnectContext(context)) {
      if (!target.available) {
        return {
          ok: false,
          message:
            target.unavailableReason ||
            "Crate Connect transfer is unavailable.",
        };
      }
      const targetInstanceId = target.id.replace(/^crate-instance:/, "");
      if (targetInstanceId === context.connect.activeInstanceId) {
        return { ok: true, message: `Already playing on ${target.name}.` };
      }
      const sent = context.connect.requestTransfer(targetInstanceId);
      return sent
        ? { ok: true, message: `Playing on ${target.name}.` }
        : { ok: false, message: "Crate Connect is still connecting." };
    }
    if (!isLegacyCrateConnectEnabled()) {
      return {
        ok: false,
        message: "Crate Connect is disabled in Settings.",
      };
    }
    if (!target.available) {
      return {
        ok: false,
        message:
          target.unavailableReason || "Crate Connect transfer is unavailable.",
      };
    }
    const targetDeviceId = target.id.replace(/^crate:/, "");
    const freshSession = await fetchActiveConnectSession().catch(() => null);
    const activeDeviceId =
      freshSession?.active_device_id || context?.activeConnectDeviceId;
    if (targetDeviceId === activeDeviceId) {
      return { ok: true, message: `Already playing on ${target.name}.` };
    }
    await context?.publishConnectState?.();
    await transferPlaybackToDevice(targetDeviceId, {
      sourceDeviceId: activeDeviceId || getListenDeviceId(),
      startPlaying: true,
    });
    return { ok: true, message: `Playing on ${target.name}.` };
  },
};

export const googleCastTargetProvider: PlaybackTargetProvider = {
  id: "google-cast",
  label: "Cast",
  getTargets: async (context) => {
    const capabilities = await getCastSenderCapabilities();
    if (!capabilities.visible) return [];

    const hasTrack = Boolean(context?.currentTrack);
    const available = capabilities.available && hasTrack;
    return [
      {
        id: "google-cast:default",
        providerId: "google-cast",
        kind: "google-cast",
        name: capabilities.targetName || "Google Cast",
        subtitle: capabilities.activeSession
          ? "Connected Cast receiver"
          : available
            ? "Choose a Cast receiver"
            : capabilities.available
              ? "Start a track before casting"
              : capabilities.reason,
        active: capabilities.activeSession,
        available,
        unavailableReason: available
          ? undefined
          : hasTrack
            ? capabilities.reason || "Google Cast is unavailable."
            : "Start a track before casting.",
        capabilities: {
          canPlay: true,
          canSeek: true,
          canSetVolume: true,
        },
      },
    ];
  },
  selectTarget: async (target, context) => {
    const currentTrack = context?.currentTrack;
    if (!currentTrack) {
      return { ok: false, message: "Start a track before casting." };
    }
    const result = await startCastSession({
      track: currentTrack,
      currentTime: context?.currentTime,
      targetDeviceId: target.id,
    });
    if (result.ok) await context?.pause?.();
    return result;
  },
};

function nativeOutputTargetKind(
  platform: string,
  routeType?: string,
): PlaybackTargetKind {
  if (platform === "ios" && routeType === "airplay") return "airplay";
  return "system-route";
}

function nativeOutputSubtitle(platform: string, routeType?: string): string {
  if (platform === "ios") {
    return routeType === "airplay"
      ? "Open AirPlay route picker"
      : "Open AirPlay and Bluetooth route picker";
  }
  return "Open Android output switcher";
}

export const nativeOutputRouteProvider: PlaybackTargetProvider = {
  id: "native-output",
  label: "System routes",
  getTargets: async () => {
    if (!isNativeOutputRoutingAvailable()) return [];
    const [capabilities, route] = await Promise.all([
      getNativeOutputCapabilities(),
      getNativeCurrentOutputRoute(),
    ]);
    const available =
      capabilities.canShowSystemOutputSwitcher ||
      capabilities.canPresentRoutePicker;
    const platform = capabilities.platform;
    const routeType = route?.type;
    return [
      {
        id: "native-output:system",
        providerId: "native-output",
        kind: nativeOutputTargetKind(platform, routeType),
        name:
          route?.name ||
          (platform === "ios" ? "AirPlay and Bluetooth" : "System output"),
        subtitle: nativeOutputSubtitle(platform, routeType),
        active: false,
        available,
        unavailableReason: available
          ? undefined
          : platform === "android"
            ? "Android output switcher requires Android 14 or newer."
            : "System route picker is unavailable on this device.",
        capabilities: {
          canPlay: true,
          canSeek: false,
          canSetVolume: false,
          canShowSystemPicker: available,
        },
      },
    ];
  },
  selectTarget: async () => {
    const result = await showNativeOutputPicker();
    return {
      ok: result.shown !== false,
      message: result.reason,
    };
  },
};

export const playbackTargetProviders: PlaybackTargetProvider[] = [
  localTargetProvider,
  nativeOutputRouteProvider,
  googleCastTargetProvider,
  crateConnectTargetProvider,
];

function isProviderList(
  value: PlaybackTargetContext | PlaybackTargetProvider[] | undefined,
): value is PlaybackTargetProvider[] {
  return Array.isArray(value);
}

function targetArgs(
  contextOrProviders?: PlaybackTargetContext | PlaybackTargetProvider[],
  providers?: PlaybackTargetProvider[],
): {
  context?: PlaybackTargetContext;
  providers: PlaybackTargetProvider[];
} {
  if (isProviderList(contextOrProviders)) {
    return { providers: contextOrProviders };
  }
  return {
    context: contextOrProviders,
    providers: providers ?? playbackTargetProviders,
  };
}

async function enrichTargetContext(
  context: PlaybackTargetContext | undefined,
): Promise<PlaybackTargetContext | undefined> {
  if (isWsCrateConnectContext(context)) return context;
  if (context?.activeConnectDeviceId !== undefined) return context;
  const session = await fetchActiveConnectSession().catch(() => null);
  return {
    ...context,
    activeConnectDeviceId: session?.active_device_id ?? null,
    activeConnectSession: session,
  };
}

export async function loadPlaybackTargetGroups(
  contextOrProviders?: PlaybackTargetContext | PlaybackTargetProvider[],
  providersArg?: PlaybackTargetProvider[],
): Promise<PlaybackTargetGroup[]> {
  const { context, providers } = targetArgs(contextOrProviders, providersArg);
  const enrichedContext = await enrichTargetContext(context);
  const groups = await Promise.all(
    providers.map(async (provider) => {
      try {
        const targets = await provider.getTargets(enrichedContext);
        return {
          providerId: provider.id,
          label: provider.label,
          targets,
        };
      } catch {
        return {
          providerId: provider.id,
          label: provider.label,
          targets: [],
          error: "Targets unavailable",
        };
      }
    }),
  );
  return groups.filter((group) => group.targets.length > 0 || group.error);
}

export async function selectPlaybackTarget(
  target: PlaybackTarget,
  contextOrProviders?: PlaybackTargetContext | PlaybackTargetProvider[],
  providersArg?: PlaybackTargetProvider[],
): Promise<PlaybackTargetSelectionResult> {
  const { context, providers } = targetArgs(contextOrProviders, providersArg);
  const provider = providers.find((item) => item.id === target.providerId);
  if (!provider) {
    return { ok: false, message: "Output target provider is unavailable." };
  }
  return provider.selectTarget(target, context);
}
