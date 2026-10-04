import {
  Brain,
  CRATE_ICON_SIZE,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Trash2,
  X,
} from "@crate/ui/icons";
import type { TFunction } from "i18next";

import { useEqualizer } from "@/hooks/use-equalizer";
import { type EqPresetName } from "@/lib/equalizer";
import { EqBands } from "@crate/ui/domain/player/EqBands";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { CratePill } from "@crate/ui/primitives/CrateBadge";
import { IconButton } from "@crate/ui/primitives/IconButton";
import { Button } from "@crate/ui/shadcn/button";
import { EqualizerSmartReadout } from "@/components/player/EqualizerSmartReadout";
import {
  AdaptiveFeatureChips,
  GenreResolutionChip,
} from "@/components/player/EqualizerAdaptiveReadouts";

const PANEL_CLOSE_BUTTON_CLASS_NAME =
  "size-9 text-text-muted hover:translate-y-0 hover:text-text-primary hover:drop-shadow-none";
const MODE_BADGE_CLASS_NAME =
  "gap-1 border-accent-action/40 px-2 py-0.5 text-xs";
const TRACK_PRESET_ACTION_CLASS_NAME =
  "h-auto gap-1 border px-2.5 py-0.5 font-normal has-[>svg]:px-2.5 [&_svg:not([class*='size-'])]:size-3";

const PRESET_LABELS: Record<EqPresetName, string> = {
  flat: "Flat",
  // General-purpose
  rock: "Rock",
  pop: "Pop",
  jazz: "Jazz",
  classical: "Classical",
  bass_boost: "Bass Boost",
  treble_boost: "Treble Boost",
  vocal: "Vocal",
  electronic: "Electronic",
  acoustic: "Acoustic",
  hip_hop: "Hip-Hop",
  // Underground / heavy
  black_metal: "Black Metal",
  death_metal: "Death Metal",
  thrash: "Thrash",
  doom: "Doom / Sludge",
  hardcore: "Hardcore",
  punk: "Punk",
  progressive: "Progressive",
  shoegaze: "Shoegaze",
  post_rock: "Post-Rock",
  lo_fi: "Indie / Lo-Fi",
};

type EqualizerState = ReturnType<typeof useEqualizer>;

function EqualizerHeader({
  eq,
  onClose,
  t,
}: {
  eq: EqualizerState;
  onClose?: () => void;
  t: TFunction;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <SlidersHorizontal
          size={CRATE_ICON_SIZE.md}
          className="text-accent-action"
        />
        <h2 className="text-sm font-semibold text-text-primary">
          {t("player.equalizer")}
        </h2>
      </div>
      <div className="flex items-center gap-2">
        <CratePill
          active={eq.smart}
          disabled={!eq.enabled}
          onClick={() => eq.toggleSmart(!eq.smart)}
          icon={Brain}
        >
          {t("player.equalizer.smart.label")}
          {eq.smart && eq.smartStatus === "loading" ? (
            <span className="ml-1 text-xs opacity-60">…</span>
          ) : null}
        </CratePill>
        <label className="flex items-center gap-1.5 text-xs font-medium text-text-primary">
          <Checkbox
            checked={eq.enabled}
            onCheckedChange={(checked) => eq.toggleEnabled(checked === true)}
            className="size-3.5"
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
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border-quiet bg-surface-control px-2.5 py-2">
      <span className="mr-1 text-xs uppercase tracking-[0.18em] text-text-subtle">
        {t("player.equalizer.manualHelpers")}
      </span>
      <CratePill
        active={eq.genreAdaptive}
        disabled={!eq.enabled}
        onClick={() => eq.toggleGenreAdaptive(!eq.genreAdaptive)}
        icon={Tag}
      >
        {t("player.equalizer.genre.label")}
        {eq.genreAdaptive && eq.genreAdaptiveStatus === "loading" ? (
          <span className="ml-1 text-xs opacity-60">…</span>
        ) : null}
      </CratePill>
      <CratePill
        active={eq.adaptive}
        disabled={!eq.enabled}
        onClick={() => eq.toggleAdaptive(!eq.adaptive)}
        icon={Sparkles}
      >
        {t("player.equalizer.adaptive.label")}
        {eq.adaptive && eq.adaptiveStatus === "loading" ? (
          <span className="ml-1 text-xs opacity-60">…</span>
        ) : null}
      </CratePill>
    </div>
  );
}

function EqualizerPresetPicker({
  eq,
  manualControlsEnabled,
}: {
  eq: EqualizerState;
  manualControlsEnabled: boolean;
}) {
  return (
    <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
      {(Object.keys(PRESET_LABELS) as EqPresetName[]).map((name) => (
        <CratePill
          key={name}
          active={
            eq.preset === name && !eq.smart && !eq.adaptive && !eq.genreAdaptive
          }
          disabled={!manualControlsEnabled}
          onClick={() => eq.applyPreset(name)}
        >
          {PRESET_LABELS[name]}
        </CratePill>
      ))}
    </div>
  );
}

function EqualizerModeBadge({
  adaptive,
  genreAdaptive,
  preset,
  smart,
  t,
}: {
  adaptive: boolean;
  genreAdaptive: boolean;
  preset: EqualizerState["preset"];
  smart: boolean;
  t: TFunction;
}) {
  if (smart) {
    return (
      <CratePill tone="accent" icon={Brain} className={MODE_BADGE_CLASS_NAME}>
        {t("player.equalizer.smartCurve")}
      </CratePill>
    );
  }
  if (adaptive) {
    return (
      <CratePill
        tone="accent"
        icon={Sparkles}
        className={MODE_BADGE_CLASS_NAME}
      >
        {t("player.equalizer.adaptiveActive")}
      </CratePill>
    );
  }
  if (genreAdaptive) {
    return (
      <CratePill tone="accent" icon={Tag} className={MODE_BADGE_CLASS_NAME}>
        {t("player.equalizer.genreActive")}
      </CratePill>
    );
  }
  if (preset === "custom") {
    return (
      <CratePill tone="neutral" className="px-2 py-0.5 text-xs">
        {t("player.equalizer.custom")}
      </CratePill>
    );
  }
  return <span />;
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
  const manualControlsEnabled =
    eq.enabled && !eq.smart && !eq.adaptive && !eq.genreAdaptive;
  const hasUserTrackPreset = eq.effectiveEq?.source === "user_track_preset";

  return (
    <div className="flex flex-col gap-4">
      <EqualizerHeader eq={eq} onClose={onClose} t={t} />
      <EqualizerModePicker eq={eq} t={t} />
      <EqualizerPresetPicker
        eq={eq}
        manualControlsEnabled={manualControlsEnabled}
      />
      <div className="flex items-center justify-between">
        <EqualizerModeBadge
          adaptive={eq.adaptive}
          genreAdaptive={eq.genreAdaptive}
          preset={eq.preset}
          smart={eq.smart}
          t={t}
        />
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
      <div className="rounded-xl border border-border-quiet bg-surface-canvas p-3">
        <EqBands
          gains={eq.gains}
          onBandChange={manualControlsEnabled ? eq.updateBand : undefined}
          disabled={!eq.enabled}
        />
      </div>
    </div>
  );
}
