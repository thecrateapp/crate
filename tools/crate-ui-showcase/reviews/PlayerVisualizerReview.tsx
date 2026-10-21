import { resolveVisualizerSettings } from "../../../app/listen/src/components/player/visualizer/visualizer-settings";
import { VisualizerSettingsPopover } from "../../../app/listen/src/components/player/visualizer/VisualizerSettingsPopover";
import type { VisualizerPanelState } from "../../../app/listen/src/components/player/visualizer/visualizer-settings";
import { Button } from "@crate/ui/shadcn/button";
import { useState } from "react";
import { PageHeader } from "@crate/ui/domain/navigation";
import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@crate/ui/shadcn/select";
import { PlayerSurfaceModeSwitch } from "../../../app/listen/src/components/player/PlayerSurfaceModeSwitch";
import { VisualizerSettingsPanel } from "../../../app/listen/src/components/player/visualizer/VisualizerSettingsPanel";
import { DEFAULT_VISUALIZER_SETTINGS } from "../../../app/listen/src/lib/player-visualizer-prefs";
import {
  VISUALIZER_SCENARIOS,
  visualizerFixture,
  type VisualizerScenario,
} from "../fixtures/player-visualizer";
import { SettingsFixtureProvider } from "./SettingsFixtureProvider";
export function PlayerVisualizerExample({
  initialScenario = "saved",
}: {
  initialScenario?: VisualizerScenario;
}) {
  const [scenario, setScenario] = useState(initialScenario);
  const [state, setState] = useState(() => visualizerFixture(initialScenario));
  const choose = (value: VisualizerScenario) => {
    setScenario(value);
    setState(visualizerFixture(value));
  };
  const [popoverOpen, setPopoverOpen] = useState(false);
  const config: VisualizerPanelState = {
    ...state,
    effectiveVizConfig: resolveVisualizerSettings(
      state.vizConfig,
      state.trackAdaptiveViz ? state.trackVizProfile.settingsDelta : undefined,
    ),
    toggleAlbumPalette: () =>
      setState((current) => ({
        ...current,
        useAlbumPalette: !current.useAlbumPalette,
      })),
    toggleTrackAdaptive: () =>
      setState((current) => ({
        ...current,
        trackAdaptiveViz: !current.trackAdaptiveViz,
      })),
    updateConfig: (next) =>
      setState((current) => ({
        ...current,
        vizConfig: next,
        effectiveVizConfig: next,
      })),
    resetConfig: () =>
      setState((current) => ({
        ...current,
        vizConfig: {
          ...DEFAULT_VISUALIZER_SETTINGS,
          separation: 0.15,
        },
        effectiveVizConfig: {
          ...DEFAULT_VISUALIZER_SETTINGS,
          separation: 0.15,
        },
      })),
  };
  return (
    <div className="grid min-w-0 gap-8">
      <div className="max-w-xs">
        <FormField label="Scenario">
          {(field) => (
            <Select
              value={scenario}
              onValueChange={(value) => choose(value as VisualizerScenario)}
            >
              <SelectTrigger {...field}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VISUALIZER_SCENARIOS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
      </div>
      <div className="grid min-w-0 items-start gap-8 md:grid-cols-2">
        <div className="grid min-w-0 gap-5">
          <FormField kind="group" label="Player display">
            {(field) => (
              <div {...field} role="group">
                <PlayerSurfaceModeSwitch
                  allowVisualizer={scenario !== "unavailable"}
                  mode={state.surfaceMode}
                  onChange={(surfaceMode) =>
                    setState((current) => ({
                      ...current,
                      surfaceMode,
                      vizEnabled: surfaceMode === "visualizer",
                    }))
                  }
                />
              </div>
            )}
          </FormField>
          <MonoLabel tone="accent">Rendering contract</MonoLabel>
          <p className="m-0 text-sm text-text-muted">
            The current artwork and audio visualizer stay in Listen. These are
            the production controls with local configuration. Reduced motion or
            Effects off keeps a static frame; a hidden or closed player stops
            rendering. A real audio analyser is required.
          </p>
          {scenario === "unavailable" ? (
            <p className="m-0 text-sm text-text-muted">
              This output has no visualizer capability. Cover and CD remain
              available.
            </p>
          ) : null}
        </div>
        <div className="min-w-0 rounded-panel border border-border-quiet bg-surface-popover p-4">
          <VisualizerSettingsPanel config={config} />
        </div>
      </div>
      <FormField kind="group" label="Production popover">
        {(field) => (
          <div
            {...field}
            role="region"
            className="relative h-[min(420px,70dvh)] min-w-0 overflow-hidden border border-border-quiet bg-surface-canvas"
          >
            <Button
              className="absolute right-4 top-2"
              variant="ghost"
              onClick={() => setPopoverOpen((value) => !value)}
            >
              Open player settings
            </Button>
            {popoverOpen ? <VisualizerSettingsPopover config={config} /> : null}
          </div>
        )}
      </FormField>
    </div>
  );
}
export function PlayerVisualizerReview() {
  return (
    <SettingsFixtureProvider>
      <main className="mx-auto grid max-w-4xl gap-8 p-4 sm:p-8">
        <PageHeader
          eyebrow="1BE · Review"
          title="Visualizer and analysis"
          subtitle="Actual Listen settings and mode controls, canonical Crate forms and local callbacks."
        />
        <PlayerVisualizerExample />
      </main>
    </SettingsFixtureProvider>
  );
}
