import { useTranslation } from "react-i18next";
import { FormField } from "@crate/ui/primitives/FormField";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Readout } from "@crate/ui/primitives/Readout";
import { Slider } from "@crate/ui/primitives/Slider";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { Switch } from "@crate/ui/primitives/Switch";
import { Button } from "@crate/ui/shadcn/button";
import type { VisualizerPanelState } from "./visualizer-settings";

const SLIDERS = [
  { key: "separation", min: 0, max: 0.5, step: 0.01, digits: 2 },
  { key: "glow", min: 0, max: 15, step: 0.5, digits: 1 },
  { key: "scale", min: 0.2, max: 3, step: 0.1, digits: 1 },
  { key: "persistence", min: 0, max: 2, step: 0.1, digits: 1 },
  { key: "octaves", min: 1, max: 5, step: 1, digits: 0 },
] as const;

export function VisualizerSettingsPanel({
  config,
  className,
}: {
  config: VisualizerPanelState;
  className?: string;
}) {
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
  const status = !vizEnabled
    ? t(
        surfaceMode === "cd"
          ? "player.visualizer.cdModeActive"
          : "player.visualizer.coverModeActive",
      )
    : !trackAdaptiveViz
      ? t("player.visualizer.adaptiveOff")
      : !trackVizProfile.hasAnalysis
        ? t("player.visualizer.waitingForAnalysis")
        : trackVizProfile.summary
          ? t("player.visualizer.usingTrackAnalysisWithSummary", {
              summary: trackVizProfile.summary,
            })
          : t("player.visualizer.usingTrackAnalysis");

  const hasAdaptedValues = trackAdaptiveViz && trackVizProfile.hasAnalysis;
  return (
    <InstrumentPanel
      as="section"
      headingLevel={3}
      ruled={false}
      className={className}
      label={{ children: t("player.visualizerSettings"), tone: "accent" }}
      actions={
        <Button type="button" size="sm" variant="ghost" onClick={resetConfig}>
          {t("player.visualizer.reset")}
        </Button>
      }
    >
      <div className="grid min-w-0 gap-5">
        <div className="grid min-w-0 gap-3">
          <FormField
            label={t("player.visualizer.albumPalette")}
            layout="inline"
          >
            <Switch
              checked={useAlbumPalette}
              onCheckedChange={toggleAlbumPalette}
            />
          </FormField>
          <FormField
            label={t("player.visualizer.trackAdaptive")}
            layout="inline"
          >
            <Switch
              checked={trackAdaptiveViz}
              onCheckedChange={toggleTrackAdaptive}
            />
          </FormField>
        </div>
        <p
          data-slot="visualizer-analysis-state"
          className="m-0 flex items-start gap-2 text-sm text-text-muted"
        >
          <StatusDot
            tone={
              vizEnabled && trackAdaptiveViz && trackVizProfile.hasAnalysis
                ? "on"
                : "off"
            }
            className="mt-1 shrink-0"
          />
          <span className="min-w-0 wrap-anywhere">{status}</span>
        </p>
        <div className="grid min-w-0 gap-4">
          {SLIDERS.map(({ key, min, max, step, digits }) => (
            <FormField
              key={key}
              label={
                <span className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span>{t(`player.visualizer.${key}`)}</span>
                  <span
                    aria-hidden="true"
                    className="flex items-baseline gap-2"
                  >
                    {hasAdaptedValues ? (
                      <>
                        <MonoLabel as="span">
                          {vizConfig[key].toFixed(digits)}
                        </MonoLabel>
                        <span>→</span>
                      </>
                    ) : null}
                    <Readout minWidthCh={0}>
                      {effectiveVizConfig[key].toFixed(digits)}
                    </Readout>
                  </span>
                </span>
              }
            >
              <Slider
                min={min}
                max={max}
                step={step}
                value={vizConfig[key]}
                aria-valuetext={
                  hasAdaptedValues
                    ? t("player.visualizer.valuePair", {
                        base: vizConfig[key].toFixed(digits),
                        effective: effectiveVizConfig[key].toFixed(digits),
                      })
                    : undefined
                }
                disabled={!vizEnabled}
                onChange={(event) =>
                  updateConfig({
                    ...vizConfig,
                    [key]: Number(event.target.value),
                  })
                }
              />
            </FormField>
          ))}
        </div>
      </div>
    </InstrumentPanel>
  );
}
