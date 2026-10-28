import type { RepeatMode, Track } from "@/contexts/player-types";
import type { ActiveConnectSession } from "@/lib/crate-connect";

import type { PlaybackTarget } from "./playback-target-data";
export type {
  PlaybackTarget,
  PlaybackTargetCapabilities,
  PlaybackTargetGroup,
  PlaybackTargetKind,
} from "./playback-target-data";

export interface PlaybackTargetSelectionResult {
  ok: boolean;
  message?: string;
}

export interface PlaybackTargetContext {
  currentTrack?: Track | null;
  currentTime?: number;
  currentIndex?: number;
  queue?: Track[];
  repeatMode?: RepeatMode;
  shuffle?: boolean;
  playbackAuthority?: "cast" | "connect" | "jam" | "local";
  volume?: number;
  activeConnectDeviceId?: string | null;
  activeConnectSession?: ActiveConnectSession | null;
  connect?: PlaybackTargetConnectContext | null;
  pause?: () => void | Promise<void>;
  pauseLocal?: () => void | Promise<void>;
  resumeLocal?: () => void | Promise<void>;
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
