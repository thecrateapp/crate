import { FilterChip } from "@crate/ui/primitives/FilterChip";
import { useEffect, useRef, useState } from "react";
import {
  Brain,
  CRATE_ICON_SIZE,
  RotateCcw,
  Save,
  Sparkles,
  Tag,
  Trash2,
  X,
} from "@crate/ui/icons";
import type { TFunction } from "i18next";

import type { EqualizerPanelState } from "./equalizer-panel-state";
import type { EqCurve, EqDataStatus } from "../../lib/equalizer-types";
import { FormField } from "@crate/ui/primitives/FormField";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@crate/ui/shadcn/select";
import { type EqPresetName } from "../../lib/equalizer";
import {
  EQ_PRESET_LABEL_KEYS,
  EQ_PRESET_LABEL_ENTRIES,
} from "../../lib/equalizer-labels";
import { EqBands } from "@crate/ui/domain/player/EqBands";
import { useMotionAllowed } from "@crate/ui/lib/motion-gate";

import { IconButton } from "@crate/ui/primitives/IconButton";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Readout } from "@crate/ui/primitives/Readout";
import { Button } from "@crate/ui/shadcn/button";
import { EqualizerSmartReadout } from "./EqualizerSmartReadout";
import {
  AdaptiveFeatureChips,
  GenreResolutionChip,
} from "./EqualizerAdaptiveReadouts";

type EqualizerState = EqualizerPanelState;

const FLAT_DISPLAY_GAINS = Array.from({ length: 10 }, () => 0);

function equalizerModeLabel(eq: EqualizerState, t: TFunction): string {
  if (!eq.enabled) return t("common.off");
  if (eq.smart) return t("player.equalizer.smartCurve");
  if (eq.adaptive) return t("player.equalizer.adaptiveActive");
  if (eq.genreAdaptive) return t("player.equalizer.genreActive");
  if (eq.preset === "custom") return t("player.equalizer.custom");
  const labelKey = EQ_PRESET_LABEL_KEYS[eq.preset as EqPresetName];
  return labelKey ? t(labelKey) : eq.preset;
}

function EqualizerHeader({
  eq,
  announcement,
  onClose,
  t,
}: {
  eq: EqualizerState;
  announcement: string;
  onClose?: () => void;
  t: TFunction;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <MonoLabel as="h2" accent={t("player.equalizer")} className="min-w-0">
        <Readout announcement={announcement}>
          {equalizerModeLabel(eq, t)}
        </Readout>
      </MonoLabel>
      <div className="flex items-center gap-2">
        <FilterChip
          active={eq.smart}
          disabled={!eq.enabled}
          onClick={() => eq.toggleSmart(!eq.smart)}
          icon={Brain}
        >
          {t("player.equalizer.smart.label")}
          {eq.smart && eq.smartStatus === "loading" ? (
            <span className="ml-1 text-xs opacity-60">…</span>
          ) : null}
        </FilterChip>
        <FilterChip
          active={eq.enabled}
          onClick={() => eq.toggleEnabled(!eq.enabled)}
        >
          {t(eq.enabled ? "common.on" : "common.off")}
        </FilterChip>
        {onClose ? (
          <IconButton onClick={onClose} label={t("player.equalizer.close")}>
            <X size={CRATE_ICON_SIZE.lg} className="size-5" />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}

function EqualizerModePicker({ eq, t }: { eq: EqualizerState; t: TFunction }) {
  if (eq.smart) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <MonoLabel as="span" className="mr-1">
        {t("player.equalizer.manualHelpers")}
      </MonoLabel>
      <FilterChip
        active={eq.genreAdaptive}
        disabled={!eq.enabled}
        onClick={() => eq.toggleGenreAdaptive(!eq.genreAdaptive)}
        icon={Tag}
      >
        {t("player.equalizer.genre.label")}
        {eq.genreAdaptive && eq.genreAdaptiveStatus === "loading" ? (
          <span className="ml-1 text-xs opacity-60">…</span>
        ) : null}
      </FilterChip>
      <FilterChip
        active={eq.adaptive}
        disabled={!eq.enabled}
        onClick={() => eq.toggleAdaptive(!eq.adaptive)}
        icon={Sparkles}
      >
        {t("player.equalizer.adaptive.label")}
        {eq.adaptive && eq.adaptiveStatus === "loading" ? (
          <span className="ml-1 text-xs opacity-60">…</span>
        ) : null}
      </FilterChip>
    </div>
  );
}

function EqualizerTrackPresetActions({
  eq,
  hasUserTrackPreset,
  manualControlsEnabled,
  onClear,
  onSave,
  saving,
  t,
}: {
  eq: EqualizerState;
  hasUserTrackPreset: boolean;
  manualControlsEnabled: boolean;
  onClear: () => void;
  onSave: () => void;
  saving: boolean;
  t: TFunction;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {hasUserTrackPreset ? (
        <Button
          variant="danger-soft"
          shape="pill"
          size="sm"
          disabled={saving}
          onClick={onClear}
        >
          <Trash2 size={CRATE_ICON_SIZE.micro} />
          {t("player.equalizer.clearTrackPreset")}
        </Button>
      ) : (
        <Button
          variant="ghost"
          shape="pill"
          size="sm"
          disabled={!eq.enabled || saving}
          onClick={onSave}
        >
          <Save size={CRATE_ICON_SIZE.micro} />
          {t("player.equalizer.saveForTrack")}
        </Button>
      )}
      <Button
        variant="ghost"
        shape="pill"
        size="sm"
        disabled={!manualControlsEnabled}
        onClick={eq.resetToFlat}
      >
        <RotateCcw size={CRATE_ICON_SIZE.micro} />
        {t("player.equalizer.reset")}
      </Button>
    </div>
  );
}

export function EqualizerPanelView({
  eq,
  onClose,
  onClear,
  onSave,
  saving,
  t,
  curves,
  curvesStatus = "idle",
}: {
  curves?: EqCurve[] | null;
  curvesStatus?: EqDataStatus;
  eq: EqualizerState;
  onClose?: () => void;
  onClear: () => void;
  onSave: () => void;
  saving: boolean;
  t: TFunction;
}) {
  const motionAllowed = useMotionAllowed();
  const manualControlsEnabled = eq.enabled;
  const hasUserTrackPreset = eq.effectiveEq?.source === "user_track_preset";
  const mode = equalizerModeLabel(eq, t);
  const [announcement, setAnnouncement] = useState(mode);
  const previewing = useRef(false);

  useEffect(() => {
    if (
      !manualControlsEnabled ||
      eq.smart ||
      eq.adaptive ||
      eq.genreAdaptive ||
      eq.preset !== "custom"
    ) {
      previewing.current = false;
    }
    if (!previewing.current) setAnnouncement(mode);
  }, [
    mode,
    manualControlsEnabled,
    eq.preset,
    eq.smart,
    eq.adaptive,
    eq.genreAdaptive,
  ]);

  return (
    <div className="flex flex-col gap-5">
      <EqualizerHeader
        eq={eq}
        announcement={announcement}
        onClose={onClose}
        t={t}
      />
      <div className="border-t border-border-quiet pt-6">
        <EqBands
          gains={eq.enabled ? eq.gains : FLAT_DISPLAY_GAINS}
          onBandInput={
            manualControlsEnabled
              ? (band, gain) => {
                  previewing.current = true;
                  eq.updateBand(band, gain);
                }
              : undefined
          }
          onBandChange={
            manualControlsEnabled
              ? (band, gain) => {
                  previewing.current = false;
                  eq.commitBand(band, gain);
                  setAnnouncement(t("player.equalizer.custom"));
                }
              : undefined
          }
          disabled={!eq.enabled}
          animate={motionAllowed}
          trackClassName="h-40"
        />
      </div>
      <EqualizerSmartReadout
        eq={eq.effectiveEq}
        status={curvesStatus === "idle" ? eq.smartStatus : curvesStatus}
        curves={curves}
        activeSource={
          !eq.enabled
            ? null
            : eq.smart
              ? (eq.effectiveEq?.source ?? null)
              : eq.adaptive
                ? eq.adaptiveStatus === "ready" && eq.adaptiveFeatures
                  ? "audio_analysis_preset"
                  : null
                : eq.genreAdaptive
                  ? eq.genreAdaptiveStatus === "ready" &&
                    eq.trackGenre?.preset?.gains.length === 10
                    ? "genre_taxonomy_preset"
                    : null
                  : eq.preset === "flat"
                    ? "flat"
                    : null
        }
      />
      <div className="flex flex-wrap items-end gap-4">
        <FormField label={t("player.equalizer.presetPicker")}>
          {(control) => (
            <Select
              value={
                eq.smart || eq.adaptive || eq.genreAdaptive ? "" : eq.preset
              }
              disabled={!eq.enabled}
              onValueChange={(value) => eq.applyPreset(value as EqPresetName)}
            >
              <SelectTrigger {...control}>
                <SelectValue placeholder={t("player.equalizer.presetPicker")} />
              </SelectTrigger>
              <SelectContent
                data-dismissible-layer-boundary
                onEscapeKeyDown={(event) => event.stopPropagation()}
              >
                {eq.preset === "custom" ? (
                  <SelectItem value="custom" disabled>
                    {t("player.equalizer.custom")}
                  </SelectItem>
                ) : null}
                {EQ_PRESET_LABEL_ENTRIES.map(([name, key]) => (
                  <SelectItem key={name} value={name}>
                    {t(key)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
        <EqualizerModePicker eq={eq} t={t} />
      </div>
      <div className="flex items-center justify-end">
        <EqualizerTrackPresetActions
          eq={eq}
          hasUserTrackPreset={hasUserTrackPreset}
          manualControlsEnabled={manualControlsEnabled}
          onClear={onClear}
          onSave={onSave}
          saving={saving}
          t={t}
        />
      </div>
      {eq.adaptive ? (
        <AdaptiveFeatureChips
          features={eq.adaptiveFeatures}
          status={eq.adaptiveStatus}
        />
      ) : null}
      {eq.genreAdaptive ? (
        <GenreResolutionChip
          genre={eq.trackGenre}
          status={eq.genreAdaptiveStatus}
        />
      ) : null}
    </div>
  );
}
