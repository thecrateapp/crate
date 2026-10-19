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

import { useEqualizer } from "@/hooks/use-equalizer";
import { type EqPresetName } from "@/lib/equalizer";
import {
  EQ_PRESET_LABEL_ENTRIES,
  EQ_PRESET_LABEL_KEYS,
} from "@/lib/equalizer-labels";
import { EqBands } from "@crate/ui/domain/player/EqBands";
import { useMotionAllowed } from "@crate/ui/lib/motion-gate";
import { Checkbox } from "@crate/ui/primitives/Checkbox";

import { IconButton } from "@crate/ui/primitives/IconButton";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Readout } from "@crate/ui/primitives/Readout";
import { Button } from "@crate/ui/shadcn/button";
import { EqualizerSmartReadout } from "@/components/player/EqualizerSmartReadout";
import {
  AdaptiveFeatureChips,
  GenreResolutionChip,
} from "@/components/player/EqualizerAdaptiveReadouts";

const PANEL_CLOSE_BUTTON_CLASS_NAME =
  "size-9 text-text-muted hover:translate-y-0 hover:text-text-primary hover:drop-shadow-none";
const TRACK_PRESET_ACTION_CLASS_NAME =
  "h-auto gap-1 border px-2.5 py-0.5 font-normal has-[>svg]:px-2.5 [&_svg:not([class*='size-'])]:size-3";

type EqualizerState = ReturnType<typeof useEqualizer>;

function equalizerModeLabel(eq: EqualizerState, t: TFunction): string {
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
        <label className="flex items-center gap-1.5 text-xs font-medium text-text-primary">
          <Checkbox
            checked={eq.enabled}
            onCheckedChange={(checked) => eq.toggleEnabled(checked === true)}
          />
          {t("common.on")}
        </label>
        {onClose ? (
          <IconButton
            onClick={onClose}
            label={t("player.equalizer.close")}
            className={PANEL_CLOSE_BUTTON_CLASS_NAME}
          >
            <X size={CRATE_ICON_SIZE.lg} className="size-5" />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}

function EqualizerModePicker({ eq, t }: { eq: EqualizerState; t: TFunction }) {
  if (eq.smart) {
    return (
      <EqualizerSmartReadout eq={eq.effectiveEq} status={eq.smartStatus} />
    );
  }

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

function EqualizerPresetPicker({
  eq,
  manualControlsEnabled,
  t,
}: {
  eq: EqualizerState;
  manualControlsEnabled: boolean;
  t: TFunction;
}) {
  return (
    <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto sm:max-h-none">
      {EQ_PRESET_LABEL_ENTRIES.map(([name, labelKey]) => (
        <FilterChip
          key={name}
          active={
            eq.preset === name && !eq.smart && !eq.adaptive && !eq.genreAdaptive
          }
          disabled={!manualControlsEnabled}
          onClick={() => eq.applyPreset(name)}
        >
          {t(labelKey)}
        </FilterChip>
      ))}
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
    <div className="flex items-center gap-1.5">
      {hasUserTrackPreset ? (
        <Button
          variant="danger-soft"
          shape="pill"
          size="xs"
          disabled={saving}
          onClick={onClear}
          className={`${TRACK_PRESET_ACTION_CLASS_NAME} border-state-danger/20 bg-state-danger/[0.06] text-state-danger/80 hover:border-state-danger/35 hover:bg-state-danger/[0.06] hover:text-state-danger disabled:cursor-wait`}
        >
          <Trash2 size={CRATE_ICON_SIZE.micro} />
          {t("player.equalizer.clearTrackPreset")}
        </Button>
      ) : (
        <Button
          variant="ghost"
          shape="pill"
          size="xs"
          disabled={!eq.enabled || saving}
          onClick={onSave}
          className={`${TRACK_PRESET_ACTION_CLASS_NAME} border-accent-action/20 bg-accent-action/[0.06] text-accent-action/80 hover:border-accent-action/35 hover:bg-accent-action/[0.06] hover:text-accent-action disabled:opacity-40`}
        >
          <Save size={CRATE_ICON_SIZE.micro} />
          {t("player.equalizer.saveForTrack")}
        </Button>
      )}
      <Button
        variant="ghost"
        shape="pill"
        size="xs"
        disabled={!manualControlsEnabled}
        onClick={eq.resetToFlat}
        className={`${TRACK_PRESET_ACTION_CLASS_NAME} border-border-quiet bg-surface-control text-text-secondary hover:border-border-interactive hover:bg-surface-control hover:text-text-primary disabled:opacity-40`}
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
}: {
  eq: EqualizerState;
  onClose?: () => void;
  onClear: () => void;
  onSave: () => void;
  saving: boolean;
  t: TFunction;
}) {
  const motionAllowed = useMotionAllowed();
  const manualControlsEnabled =
    eq.enabled && !eq.smart && !eq.adaptive && !eq.genreAdaptive;
  const hasUserTrackPreset = eq.effectiveEq?.source === "user_track_preset";
  const mode = equalizerModeLabel(eq, t);
  const [announcement, setAnnouncement] = useState(mode);
  const previewing = useRef(false);

  useEffect(() => {
    if (!manualControlsEnabled || eq.preset !== "custom") {
      previewing.current = false;
    }
    if (!previewing.current) setAnnouncement(mode);
  }, [mode, manualControlsEnabled, eq.preset]);

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
          gains={eq.gains}
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
      <div className="border-t border-border-quiet pt-4">
        <EqualizerPresetPicker
          eq={eq}
          manualControlsEnabled={manualControlsEnabled}
          t={t}
        />
      </div>
      <EqualizerModePicker eq={eq} t={t} />
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
