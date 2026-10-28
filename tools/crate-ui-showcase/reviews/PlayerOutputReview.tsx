import { PlayerVolumeControl } from "../../../app/listen/src/components/player/bar/PlayerVolumeControl";
import { PlayerProgressBeam } from "../../../app/listen/src/components/player/bar/PlayerProgressBeam";
import { useState } from "react";
import { PageHeader } from "@crate/ui/domain/navigation";
import { AppPopover } from "@crate/ui/primitives/AppPopover";
import { FormField } from "@crate/ui/primitives/FormField";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@crate/ui/shadcn/select";
import { PlaybackTargetPanel } from "../../../app/listen/src/components/player/PlaybackTargetPanel";
import { PlaybackTargetPicker } from "../../../app/listen/src/components/player/PlaybackTargetPicker";
import type { PlaybackTarget } from "../../../app/listen/src/lib/playback-target-data";
import {
  OUTPUT_SCENARIOS,
  outputGroups,
  type OutputScenario,
} from "../fixtures/player-output";
import { SettingsFixtureProvider } from "./SettingsFixtureProvider";

export function PlayerOutputExample({
  initialScenario = "available",
}: {
  initialScenario?: OutputScenario;
}) {
  const [scenario, setScenario] = useState<OutputScenario>(initialScenario);
  const [volume, setVolume] = useState(0.5);
  const [selected, setSelected] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState("No action yet");
  const groups = outputGroups(scenario, selected);
  const changeScenario = (value: OutputScenario) => {
    setScenario(value);
    setSelected(null);
  };
  const onTarget = async (target: PlaybackTarget) => {
    if (!target.available) {
      setLastAction(target.unavailableReason ?? "Unavailable");
      return false;
    }
    setSelected(target.id);
    setLastAction(`Selected ${target.name}`);
    return true;
  };
  const disconnect = async () => {
    setLastAction("Disconnect: receiver keeps playing");
    return true;
  };
  const stop = async () => {
    setLastAction("Stop casting: receiver playback stops");
    return true;
  };
  const panel = {
    groups,
    loading: scenario === "loading",
    error: scenario === "error",
    pendingTargetId: scenario === "pending" ? "cast" : null,
    castAction: null,
    onRetry: () => changeScenario("available"),
  };
  return (
    <div className="grid min-w-0 gap-8">
      <div className="max-w-xs">
        <FormField label="Scenario">
          {(field) => (
            <Select
              value={scenario}
              onValueChange={(value) => changeScenario(value as OutputScenario)}
            >
              <SelectTrigger {...field}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OUTPUT_SCENARIOS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
      </div>
      <div className="grid min-w-0 items-start gap-8 md:grid-cols-2">
        <FormField kind="group" label="Output panel">
          {(field) => (
            <section {...field} role="region" className="min-w-0">
              <AppPopover className="w-full max-w-sm">
                <PlaybackTargetPanel
                  {...panel}
                  onTarget={(target) => void onTarget(target)}
                  onDisconnectCast={() => void disconnect()}
                  onStopCast={() => void stop()}
                />
              </AppPopover>
            </section>
          )}
        </FormField>
        <div className="grid min-w-0 gap-8">
          <InstrumentPanel
            label={{ children: "Interactive picker", tone: "accent" }}
            description="Open the production picker. Arrow keys navigate; Escape returns focus. Selection only records a local action."
          >
            <PlaybackTargetPicker
              {...panel}
              onTarget={onTarget}
              onDisconnectCast={disconnect}
              onStopCast={stop}
            />
          </InstrumentPanel>
          <InstrumentPanel
            label={{ children: "Volume and progress", tone: "accent" }}
            description="Hover to adjust; click to mute and restore. Scroll over the icon or slider to adjust volume without scrolling the page; hold Shift for finer steps. Arrow keys open the slider for keyboard use. Outside the control it closes after 2.5 seconds. Touch keeps a separate mute action."
          >
            <div className="flex items-center gap-4">
              <PlayerVolumeControl
                volume={volume}
                onVolumeChange={setVolume}
                onOverlayChange={() => {}}
              />
              <div
                aria-label="Progress reference"
                className="listen-player-progress relative h-11 min-w-0 flex-1"
              >
                <PlayerProgressBeam progressPercent={55} />
              </div>
            </div>
          </InstrumentPanel>
          <div
            role="status"
            aria-label="Local fixture action"
            className="grid gap-2"
          >
            <MonoLabel>Local callbacks only</MonoLabel>
            <p className="m-0 text-sm wrap-anywhere">{lastAction}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
export function PlayerOutputReview() {
  return (
    <SettingsFixtureProvider>
      <main className="mx-auto grid max-w-5xl gap-8 p-4 sm:p-8">
        <PageHeader
          eyebrow="1BE · Review"
          title="Output and devices"
          subtitle="Actual Listen output views, common Crate components and local fixture callbacks."
        />
        <PlayerOutputExample />
      </main>
    </SettingsFixtureProvider>
  );
}
