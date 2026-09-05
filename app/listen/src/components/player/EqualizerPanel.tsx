import {
  Activity,
  Brain,
  CRATE_ICON_SIZE,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Tag,
  Trash2,
  Volume2,
  X,
  Zap,
} from "@crate/ui/icons";
import { useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { EffectiveEq } from "@/hooks/use-effective-eq";
import type { EqFeatures } from "@/hooks/use-eq-features";
import { useEqualizer } from "@/hooks/use-equalizer";
import type { TrackGenre } from "@/hooks/use-track-genre";
import { type EqPresetName } from "@/lib/equalizer";
import { EqBands } from "@crate/ui/domain/player/EqBands";
import { CratePill, CrateChip } from "@crate/ui/primitives/CrateBadge";

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

const SMART_EQ_SOURCE_LABELS: Record<EffectiveEq["source"], string> = {
  user_track_preset: "User track preset",
  instance_track_preset: "Curator track preset",
  instance_album_preset: "Curator album preset",
  genre_taxonomy_preset: "Genre taxonomy",
  audio_analysis_preset: "Audio analysis",
  flat: "Flat",
};

function SmartEqReadout({
  eq,
  status,
}: {
  eq: EffectiveEq | null;
  status: "idle" | "loading" | "ready" | "unavailable";
}) {
  const { t } = useTranslation();
  if (status === "loading") {
    return (
      <div className="rounded-lg border border-accent-action/20 bg-accent-action/[0.07] px-3 py-2 text-[11px] text-accent-action/80">
        {t("player.equalizer.smart.resolving")}
      </div>
    );
  }

  if (status === "unavailable" || !eq) {
    return (
      <div className="rounded-lg border border-border-quiet bg-surface-control px-3 py-2 text-[11px] text-text-muted">
        {t("player.equalizer.smart.waiting")}
      </div>
    );
  }

  const label = SMART_EQ_SOURCE_LABELS[eq.source] ?? eq.label;
  const detail =
    eq.source === "genre_taxonomy_preset" && eq.genre
      ? eq.inheritedFrom
        ? `Inherited from ${eq.inheritedFrom.name}`
        : eq.genre.name
      : eq.reasoning || eq.label;

  return (
    <div className="eq-smart-surface rounded-lg border border-accent-action/25 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-action/35 bg-accent-action/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent-action">
          <Brain size={10} />
          Smart
        </span>
        <span className="text-xs font-semibold text-text-primary">{label}</span>
      </div>
      {detail ? (
        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-text-muted">
          {detail}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Labeled chip showing a single adaptive feature with its value and a
 * terse semantic classifier (dark/neutral/bright, compressed/moderate/
 * dynamic, etc.). Renders a subtle cyan accent when the value lands in
 * a zone where the adaptive heuristic actually acts on it.
 */
function FeatureChip({
  icon: Icon,
  label,
  value,
  zone,
}: {
  icon: typeof Sun;
  label: string;
  value: string;
  zone: "neutral" | "active";
}) {
  return (
    <CrateChip
      active={zone === "active"}
      icon={Icon}
      className="font-mono tabular-nums"
    >
      <span title={label}>{value}</span>
    </CrateChip>
  );
}

type AdaptiveFeatureChipData = {
  key: string;
  icon: typeof Sun;
  label: string;
  value: string;
  zone: "neutral" | "active";
};

function getAdaptiveFeatureChipData(
  features: EqFeatures,
): AdaptiveFeatureChipData[] {
  const chips: AdaptiveFeatureChipData[] = [];

  if (typeof features.brightness === "number") {
    const brightness = features.brightness;
    const label =
      brightness < 0.25
        ? "dark"
        : brightness < 0.4
          ? "warm"
          : brightness > 0.7
            ? "sharp"
            : brightness > 0.55
              ? "bright"
              : "neutral";
    chips.push({
      key: "brightness",
      icon: Sun,
      label: `Brightness: ${label}`,
      value: `${Math.round(brightness * 100)}%`,
      zone: brightness < 0.4 || brightness > 0.55 ? "active" : "neutral",
    });
  }

  if (typeof features.loudness === "number") {
    const loudness = features.loudness;
    chips.push({
      key: "loudness",
      icon: Volume2,
      label:
        loudness > -10
          ? "Hot master"
          : loudness < -20
            ? "Very quiet"
            : "Standard level",
      value: `${loudness.toFixed(1)} LUFS`,
      zone: loudness > -10 || loudness < -20 ? "active" : "neutral",
    });
  }

  if (typeof features.dynamicRange === "number") {
    const dynamicRange = features.dynamicRange;
    const label =
      dynamicRange > 14
        ? "preserved"
        : dynamicRange < 6
          ? "compressed"
          : "moderate";
    chips.push({
      key: "dynamic",
      icon: Activity,
      label: `Dynamic range: ${label}`,
      value: `${dynamicRange.toFixed(1)} dB`,
      zone: dynamicRange > 14 || dynamicRange < 6 ? "active" : "neutral",
    });
  }

  if (typeof features.energy === "number") {
    const energy = features.energy;
    chips.push({
      key: "energy",
      icon: Zap,
      label:
        energy > 0.7
          ? "High energy"
          : energy < 0.3
            ? "Low energy"
            : "Moderate energy",
      value: `${Math.round(energy * 100)}%`,
      zone: energy > 0.7 || energy < 0.3 ? "active" : "neutral",
    });
  }

  return chips;
}

function AdaptiveFeatureChips({
  features,
  status,
}: {
  features: EqFeatures | null;
  status: "idle" | "loading" | "ready" | "unavailable";
}) {
  const { t } = useTranslation();
  if (status === "loading") {
    return (
      <div className="rounded-md border border-border-quiet bg-surface-control px-2.5 py-1.5 text-[10px] text-text-muted">
        {t("player.equalizer.adaptive.loading")}
      </div>
    );
  }
  if (status === "unavailable" || !features) {
    return (
      <div className="rounded-md border border-border-quiet bg-surface-control px-2.5 py-1.5 text-[10px] text-text-muted">
        {t("player.equalizer.adaptive.unavailable")}
      </div>
    );
  }

  const chips = getAdaptiveFeatureChipData(features);
  if (chips.length === 0) {
    return (
      <div className="rounded-md border border-border-quiet bg-surface-control px-2.5 py-1.5 text-[10px] text-text-muted">
        {t("player.equalizer.adaptive.empty")}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[9px] uppercase tracking-wider text-text-subtle">
        {t("player.equalizer.track")}
      </span>
      {chips.map(({ key, ...chip }) => (
        <FeatureChip key={key} {...chip} />
      ))}
    </div>
  );
}

/**
 * Readout for the genre-adaptive mode. Shows what genre the track
 * reports + how the backend resolved its EQ preset (direct hit vs
 * inherited from an ancestor vs nothing). Keeps the behavior
 * transparent so it doesn't feel like a black box when the curve
 * suddenly changes mid-track.
 */
function GenreResolutionChip({
  genre,
  status,
}: {
  genre: TrackGenre | null;
  status: "idle" | "loading" | "ready" | "unavailable";
}) {
  const { t } = useTranslation();
  if (status === "loading") {
    return (
      <div className="rounded-md border border-border-quiet bg-surface-control px-2.5 py-1.5 text-[10px] text-text-muted">
        {t("player.equalizer.genre.loading")}
      </div>
    );
  }
  if (status === "unavailable" || !genre?.primary) {
    return (
      <div className="rounded-md border border-border-quiet bg-surface-control px-2.5 py-1.5 text-[10px] text-text-muted">
        {t("player.equalizer.genre.unavailable")}
      </div>
    );
  }

  const primaryName = genre.primary.name;
  const canonical = genre.primary.canonical;
  const preset = genre.preset;

  if (!canonical) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border-quiet bg-surface-control px-2.5 py-1.5 text-[10px] text-text-secondary">
        <Tag size={10} className="opacity-70" />
        <span className="font-medium capitalize text-text-primary/80">
          {primaryName}
        </span>
        <span className="opacity-50">
          {t("player.equalizer.genre.unmapped")}
        </span>
      </div>
    );
  }

  if (!preset) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border-quiet bg-surface-control px-2.5 py-1.5 text-[10px] text-text-secondary">
        <Tag size={10} className="opacity-70" />
        <span className="font-medium capitalize text-text-primary/80">
          {primaryName}
        </span>
        <span className="opacity-50">
          {t("player.equalizer.genre.noPreset")}
        </span>
      </div>
    );
  }

  const isInherited = preset.source === "inherited";
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-accent-action/30 bg-accent-action/10 px-2.5 py-1.5 text-[10px] text-accent-action">
      <Tag size={10} />
      <span className="font-medium capitalize">{primaryName}</span>
      <span className="opacity-70">
        {isInherited
          ? t("player.equalizer.genre.inherited")
          : t("player.equalizer.genre.preset")}
      </span>
      {isInherited && preset.inheritedFrom ? (
        <span className="font-medium capitalize opacity-80">
          {t("player.equalizer.genre.from", {
            name: preset.inheritedFrom.name,
          })}
        </span>
      ) : null}
    </div>
  );
}

interface EqualizerPanelProps {
  /** Shown as a header action — optional, typically the close button. */
  onClose?: () => void;
}

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
            <span className="ml-1 text-[9px] opacity-60">…</span>
          ) : null}
        </CratePill>
        <label className="flex items-center gap-1.5 text-xs font-medium text-text-primary">
          <input
            type="checkbox"
            checked={eq.enabled}
            onChange={(event) => eq.toggleEnabled(event.target.checked)}
            className="h-3.5 w-3.5 accent-accent-action"
          />
          {t("common.on")}
        </label>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label={t("player.equalizer.close")}
            className="flex size-9 items-center justify-center text-text-muted hover:text-text-primary"
          >
            <X size={CRATE_ICON_SIZE.lg} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function EqualizerModePicker({ eq, t }: { eq: EqualizerState; t: TFunction }) {
  if (eq.smart) {
    return <SmartEqReadout eq={eq.effectiveEq} status={eq.smartStatus} />;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border-quiet bg-surface-control px-2.5 py-2">
      <span className="mr-1 text-[9px] uppercase tracking-[0.18em] text-text-subtle">
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
          <span className="ml-1 text-[9px] opacity-60">…</span>
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
          <span className="ml-1 text-[9px] opacity-60">…</span>
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
      <span className="flex items-center gap-1 rounded-full border border-accent-action/40 bg-accent-action/10 px-2 py-0.5 text-[10px] text-accent-action">
        <Brain size={9} />
        {t("player.equalizer.smartCurve")}
      </span>
    );
  }
  if (adaptive) {
    return (
      <span className="flex items-center gap-1 rounded-full border border-accent-action/40 bg-accent-action/10 px-2 py-0.5 text-[10px] text-accent-action">
        <Sparkles size={9} />
        {t("player.equalizer.adaptiveActive")}
      </span>
    );
  }
  if (genreAdaptive) {
    return (
      <span className="flex items-center gap-1 rounded-full border border-accent-action/40 bg-accent-action/10 px-2 py-0.5 text-[10px] text-accent-action">
        <Tag size={9} />
        {t("player.equalizer.genreActive")}
      </span>
    );
  }
  if (preset === "custom") {
    return (
      <span className="rounded-full border border-border-quiet bg-surface-control px-2 py-0.5 text-[10px] text-text-secondary">
        {t("player.equalizer.custom")}
      </span>
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
        <button
          type="button"
          disabled={saving}
          onClick={onClear}
          className="inline-flex items-center gap-1 rounded-full border border-state-danger/20 bg-state-danger/[0.06] px-2.5 py-0.5 text-[10px] text-state-danger/80 hover:border-state-danger/35 hover:text-state-danger disabled:cursor-wait disabled:opacity-50"
        >
          <Trash2 size={9} />
          {t("player.equalizer.clearTrackPreset")}
        </button>
      ) : (
        <button
          type="button"
          disabled={!eq.enabled || saving}
          onClick={onSave}
          className="inline-flex items-center gap-1 rounded-full border border-accent-action/20 bg-accent-action/[0.06] px-2.5 py-0.5 text-[10px] text-accent-action/80 hover:border-accent-action/35 hover:text-accent-action disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Save size={9} />
          {t("player.equalizer.saveForTrack")}
        </button>
      )}
      <button
        type="button"
        disabled={!manualControlsEnabled}
        onClick={eq.resetToFlat}
        className={`inline-flex items-center gap-1 rounded-full border border-border-quiet bg-surface-control px-2.5 py-0.5 text-[10px] text-text-secondary hover:border-border-interactive hover:text-text-primary ${
          !manualControlsEnabled ? "cursor-not-allowed opacity-40" : ""
        }`}
      >
        <RotateCcw size={9} />
        {t("player.equalizer.reset")}
      </button>
    </div>
  );
}

function EqualizerPanelView({
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

export function EqualizerPanel({ onClose }: EqualizerPanelProps) {
  const { t } = useTranslation();
  const eq = useEqualizer();
  const [saving, setSaving] = useState(false);

  const handleSaveTrack = async () => {
    setSaving(true);
    try {
      const result = await eq.saveForCurrentTrack();
      if (result) toast.success(t("player.equalizer.toasts.saved"));
      else toast.error(t("player.equalizer.toasts.cannotSave"));
    } catch (error) {
      console.error("[eq] failed to save track preset", error);
      toast.error(t("player.equalizer.toasts.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleClearTrack = async () => {
    setSaving(true);
    try {
      await eq.clearCurrentTrackPreset();
      toast.success(t("player.equalizer.toasts.cleared"));
    } catch (error) {
      console.error("[eq] failed to clear track preset", error);
      toast.error(t("player.equalizer.toasts.clearFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <EqualizerPanelView
      eq={eq}
      onClose={onClose}
      onClear={() => void handleClearTrack()}
      onSave={() => void handleSaveTrack()}
      saving={saving}
      t={t}
    />
  );
}
