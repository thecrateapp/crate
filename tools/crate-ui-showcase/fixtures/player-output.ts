import type {
  PlaybackTarget,
  PlaybackTargetGroup,
} from "../../../app/listen/src/lib/playback-target-data";
export const OUTPUT_SCENARIOS = [
  "available",
  "cast",
  "connect",
  "native",
  "unavailable",
  "loading",
  "error",
  "partial",
  "empty",
  "pending",
  "long",
] as const;
export type OutputScenario = (typeof OUTPUT_SCENARIOS)[number];
const capabilities = { canPlay: true, canSeek: true, canSetVolume: true };
const local: PlaybackTarget = {
  id: "local",
  providerId: "local",
  kind: "local",
  name: "Crate on this browser",
  subtitle: "System-selected output",
  active: true,
  available: true,
  capabilities,
};
const cast: PlaybackTarget = {
  id: "cast",
  providerId: "google-cast",
  kind: "google-cast",
  name: "Living room TV",
  subtitle: "Choose a Cast receiver",
  active: false,
  available: true,
  capabilities,
};
const connect: PlaybackTarget = {
  id: "connect",
  providerId: "crate-connect",
  kind: "crate-device",
  name: "Studio desktop",
  subtitle: "Available through Crate Connect",
  active: false,
  available: true,
  capabilities,
};
const native: PlaybackTarget = {
  id: "native",
  providerId: "native-output",
  kind: "airplay",
  name: "AirPlay and Bluetooth",
  subtitle: "Open system route picker",
  active: false,
  available: true,
  capabilities: {
    ...capabilities,
    canSeek: false,
    canSetVolume: false,
    canShowSystemPicker: true,
  },
};
export function outputGroups(
  scenario: OutputScenario,
  selectedId?: string | null,
): PlaybackTargetGroup[] {
  if (scenario === "empty" || scenario === "error") return [];
  const targets = [{ ...local }, { ...cast }, { ...connect }];
  if (scenario === "native") targets.push({ ...native });
  if (scenario === "unavailable")
    Object.assign(targets[1]!, {
      available: false,
      subtitle: "Start a track before casting.",
      unavailableReason: "Start a track before casting.",
    });
  if (scenario === "long")
    Object.assign(targets[2]!, {
      name: "Studio desktop in the upstairs listening room with an unusually long device name",
      available: false,
      unavailableReason:
        "Switch playback to this device before starting this output. Your music stays on the current device until a supported transfer is available.",
    });
  const selected =
    selectedId ??
    (scenario === "cast"
      ? "cast"
      : scenario === "connect"
        ? "connect"
        : "local");
  for (const target of targets) target.active = target.id === selected;
  const groups = targets.map((target) => ({
    providerId: target.providerId,
    label: target.providerId,
    targets: [target],
  }));
  if (scenario === "partial")
    groups.push({
      providerId: "native-output",
      label: "System routes",
      targets: [],
      error: "Targets unavailable",
    } as PlaybackTargetGroup);
  return groups;
}
