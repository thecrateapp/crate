import { useTranslation } from "react-i18next";

import { Switch } from "@crate/ui/primitives/Switch";

import type { VisualizerConfigState } from "./useVisualizerConfig";

interface VisualizerSettingsPanelProps {
  config: VisualizerConfigState;
  className?: string;
}

const SLIDERS = [
  {
    key: "separation" as const,
    labelKey: "player.visualizer.separation",
    min: 0,
    max: 0.5,
    step: 0.01,
  },
  {
    key: "glow" as const,
    labelKey: "player.visualizer.glow",
    min: 0,
    max: 15,
    step: 0.5,
  },
  {
    key: "scale" as const,
    labelKey: "player.visualizer.scale",
    min: 0.2,
    max: 3,
    step: 0.1,
  },
  {
    key: "persistence" as const,
    labelKey: "player.visualizer.persistence",
    min: 0,
    max: 2,
    step: 0.1,
  },
  {
    key: "octaves" as const,
    labelKey: "player.visualizer.octaves",
    min: 1,
    max: 5,
    step: 1,
  },
] as const;

function Toggle({
  label,
  on,
  onToggle,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <Switch
      size="sm"
      aria-label={label}
      checked={on}
      onCheckedChange={onToggle}
    />
  );
}

export function VisualizerSettingsPanel({
  config,
  className,
}: VisualizerSettingsPanelProps) {
  const { t } = useTranslation();
  const {
    surfaceMode,
    vizEnabled,
    useAlbumPalette,
    trackAdaptiveViz,
    vizConfig,
    effectiveVizConfig,
    trackVizProfile,
    toggleAlbumPalette,
    toggleTrackAdaptive,
    updateConfig,
    resetConfig,
  } = config;

  return (
    <div className={`space-y-3 ${className ?? ""}`}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-text-muted">
          {t("player.visualizerSettings")}
        </span>
        <button
          type="button"
          onClick={resetConfig}
          className="text-xs link-accent"
        >
          {t("player.visualizer.reset")}
        </button>
      </div>

      <div
        className={`flex items-center justify-between transition-opacity ${
          vizEnabled ? "" : "opacity-45"
        }`}
      >
        <span className="text-xs text-text-muted">
          {t("player.visualizer.albumPalette")}
        </span>
        <Toggle
          label={t("player.visualizer.albumPalette")}
          on={useAlbumPalette}
          onToggle={toggleAlbumPalette}
        />
      </div>

      <div
        className={`flex items-center justify-between transition-opacity ${
          vizEnabled ? "" : "opacity-45"
        }`}
      >
        <span className="text-xs text-text-muted">
          {t("player.visualizer.trackAdaptive")}
        </span>
        <Toggle
          label={t("player.visualizer.trackAdaptive")}
          on={trackAdaptiveViz}
          onToggle={toggleTrackAdaptive}
        />
      </div>

      <div className="rounded-md border border-border-quiet bg-surface-control px-2.5 py-2 text-xs text-text-muted">
        {!vizEnabled
          ? surfaceMode === "cd"
            ? t("player.visualizer.cdModeActive")
            : t("player.visualizer.coverModeActive")
          : trackAdaptiveViz
            ? trackVizProfile.hasAnalysis
              ? trackVizProfile.summary
                ? t("player.visualizer.usingTrackAnalysisWithSummary", {
                    summary: trackVizProfile.summary,
                  })
                : t("player.visualizer.usingTrackAnalysis")
              : t("player.visualizer.waitingForAnalysis")
            : t("player.visualizer.adaptiveOff")}
      </div>

      {SLIDERS.map(({ key, labelKey, min, max, step }) => (
        <div
          key={key}
          className={`transition-opacity ${vizEnabled ? "" : "opacity-45"}`}
        >
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-text-subtle">{t(labelKey)}</span>
            <div className="flex items-center gap-2 font-mono">
              {trackAdaptiveViz ? (
                <span className="text-text-subtle">
                  {vizConfig[key].toFixed(key === "octaves" ? 0 : 1)}
                </span>
              ) : null}
              <span className="text-text-secondary">
                {effectiveVizConfig[key].toFixed(key === "octaves" ? 0 : 1)}
              </span>
            </div>
          </div>
          <input
            type="range"
            aria-label={t(labelKey)}
            min={min}
            max={max}
            step={step}
            value={vizConfig[key]}
            disabled={!vizEnabled}
            onChange={(event) =>
              updateConfig({
                ...vizConfig,
                [key]: parseFloat(event.target.value),
              })
            }
            className="h-1 w-full accent-accent-action"
          />
        </div>
      ))}
    </div>
  );
}
