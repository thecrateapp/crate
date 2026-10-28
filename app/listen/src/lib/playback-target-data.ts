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

export interface PlaybackTargetGroup {
  providerId: string;
  label: string;
  targets: PlaybackTarget[];
  error?: string;
}
