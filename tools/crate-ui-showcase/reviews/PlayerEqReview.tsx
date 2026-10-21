import { useState, useRef } from "react";
import { EQ_PRESETS } from "../../../app/listen/src/lib/equalizer";
import { useTranslation } from "react-i18next";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
import { Button } from "@crate/ui/shadcn/button";
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
import { EqualizerPanelView } from "../../../app/listen/src/components/player/EqualizerPanelSections";
import { EqualizerAnchoredSurface } from "../../../app/listen/src/components/player/EqualizerPanelSurface";
import type { EqualizerPanelState } from "../../../app/listen/src/components/player/equalizer-panel-state";
import { SettingsFixtureProvider } from "./SettingsFixtureProvider";
import {
  EQ_SCENARIOS,
  TRACK_CURVES,
  effectiveCurve,
  type EqScenario,
} from "../fixtures/player-eq";
export function PlayerEqExample({
  initialScenario = "smart",
}: {
  initialScenario?: EqScenario;
}) {
  const { t } = useTranslation();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  useDismissibleLayer({
    active: panelOpen,
    refs: [surfaceRef, controlsRef],
    onDismiss: () => setPanelOpen(false),
  });
  const [scenario, setScenario] = useState<EqScenario>(initialScenario);
  const [smart, setSmart] = useState(
    !["manual", "adaptive", "genre"].includes(initialScenario),
  );
  const [enabled, setEnabled] = useState(initialScenario !== "off");
  const [adaptive, setAdaptive] = useState(initialScenario === "adaptive");
  const [genre, setGenre] = useState(initialScenario === "genre");
  const [gains, setGains] = useState([...TRACK_CURVES[0]!.gains]);
  const [preset, setPreset] = useState("custom");
  const [notice, setNotice] = useState("");
  const choose = (value: EqScenario) => {
    setScenario(value);
    setPanelOpen(true);
    setSmart(!["manual", "adaptive", "genre"].includes(value));
    setEnabled(value !== "off");
    setAdaptive(value === "adaptive");
    setGenre(value === "genre");
    setGains([...TRACK_CURVES[0]!.gains]);
    setPreset("custom");
    setNotice("");
  };
  const missing = scenario === "loading" || scenario === "unavailable";
  const eq: EqualizerPanelState = {
    enabled,
    preset,
    gains,
    smart,
    adaptive,
    genreAdaptive: genre,
    effectiveEq:
      missing || !smart
        ? null
        : {
            ...effectiveCurve(TRACK_CURVES[0]!),
            reasoning:
              scenario === "long"
                ? "A saved personal equalization curve for this recording, preserving its low-end balance and the detail of its high frequencies. This description wraps naturally inside the same production panel."
                : "Your saved track curve.",
          },
    smartStatus:
      scenario === "loading"
        ? "loading"
        : scenario === "unavailable"
          ? "unavailable"
          : "ready",
    adaptiveStatus: "unavailable",
    adaptiveFeatures: null,
    genreAdaptiveStatus: "unavailable",
    trackGenre: null,
    toggleEnabled: setEnabled,
    toggleSmart: (value) => {
      setSmart(value);
      setAdaptive(false);
      setGenre(false);
    },
    toggleAdaptive: (value) => {
      setAdaptive(value);
      setGenre(false);
      setSmart(false);
    },
    toggleGenreAdaptive: (value) => {
      setGenre(value);
      setAdaptive(false);
      setSmart(false);
    },
    applyPreset: (value) => {
      setPreset(value);
      setGains([...EQ_PRESETS[value]!]);
      setSmart(false);
      setAdaptive(false);
      setGenre(false);
    },
    updateBand: (band, gain) => {
      setGains((old) => old.map((v, i) => (i === band ? gain : v)));
      setPreset("custom");
      setSmart(false);
      setAdaptive(false);
      setGenre(false);
    },
    commitBand: () => {},
    resetToFlat: () => {
      setGains(Array(10).fill(0));
      setPreset("flat");
    },
  };
  const curves = missing || scenario === "legacy" ? null : TRACK_CURVES;
  return (
    <div className="grid min-w-0 gap-6">
      <div
        ref={controlsRef}
        className="flex flex-wrap items-end gap-4"
        data-dismissible-layer-boundary
      >
        <FormField label="Scenario">
          {(control) => (
            <Select
              value={scenario}
              onValueChange={(v) => choose(v as EqScenario)}
            >
              <SelectTrigger {...control}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                data-dismissible-layer-boundary
                onEscapeKeyDown={(event) => event.stopPropagation()}
              >
                {EQ_SCENARIOS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
        {!panelOpen ? (
          <Button variant="outline" onClick={() => setPanelOpen(true)}>
            Open equalizer
          </Button>
        ) : null}
      </div>
      <div
        data-testid="eq-parent"
        className={
          scenario === "short"
            ? "relative h-80 min-w-0"
            : "relative h-[44rem] min-w-0"
        }
      >
        {panelOpen ? (
          <EqualizerAnchoredSurface
            ref={surfaceRef}
            label={t("player.equalizer")}
          >
            <EqualizerPanelView
              eq={eq}
              curves={curves}
              curvesStatus={
                missing
                  ? eq.smartStatus
                  : scenario === "legacy"
                    ? "unavailable"
                    : "ready"
              }
              t={t}
              saving={false}
              onClose={() => setPanelOpen(false)}
              onClear={() => setNotice("Track curve cleared (local example)")}
              onSave={() => setNotice("Track curve saved (local example)")}
            />
          </EqualizerAnchoredSurface>
        ) : null}
      </div>
      {notice ? <MonoLabel>{notice}</MonoLabel> : null}
    </div>
  );
}
export function PlayerEqReview() {
  return (
    <SettingsFixtureProvider>
      <main className="mx-auto grid max-w-6xl gap-8 p-4 sm:p-8">
        <PageHeader eyebrow="1BE · Review" title="Equalizer refinement" />
        <PlayerEqExample />
      </main>
    </SettingsFixtureProvider>
  );
}
