import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { useTranslation } from "react-i18next";

import { formatPlayerTime } from "@/components/player/bar/player-bar-utils";

interface PlayerSeekBarProps {
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  compact?: boolean;
  thin?: boolean;
  showTimes?: boolean;
  className?: string;
  variant?: "default" | "glow";
  disabled?: boolean;
}

interface SeekBarModel {
  safeDuration: number;
  displayedTime: number;
  progress: number;
  hoverPercent: number | null;
  hoverTime: string | null;
  trackRef: RefObject<HTMLDivElement | null>;
  sliderStyle: {
    accentColor: string;
    background: string;
  };
  glowTrackClass: string;
  glowWidthStyle: { width: string };
  glowLeftStyle: { left: string };
  beginScrubbing: () => void;
  endScrubbing: () => void;
  handleHover: (event: PointerEvent<HTMLDivElement>) => void;
  clearHover: () => void;
  stopPropagation: (event: SyntheticEvent) => void;
  commitSeek: (value: number) => void;
}

function stopEventPropagation(event: SyntheticEvent) {
  event.stopPropagation();
}

function useSeekBarModel(
  currentTime: number,
  duration: number,
  thin: boolean,
  onSeek: (time: number) => void,
): SeekBarModel {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [draftTime, setDraftTime] = useState<number | null>(null);
  const [hoverPercent, setHoverPercent] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const displayedTime =
    isScrubbing && draftTime != null ? draftTime : currentTime;
  const progress =
    safeDuration > 0
      ? Math.max(0, Math.min(100, (displayedTime / safeDuration) * 100))
      : 0;
  const sliderStyle = useMemo(
    () => ({
      accentColor: "var(--accent-action)",
      background: `linear-gradient(90deg, var(--accent-action) 0%, var(--accent-action) ${progress}%, var(--surface-quiet) ${progress}%, var(--surface-quiet) 100%)`,
    }),
    [progress],
  );
  const hoverTime =
    hoverPercent != null && safeDuration > 0
      ? formatPlayerTime(hoverPercent * safeDuration)
      : null;

  const handleHover = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const element = trackRef.current;
      if (!element || safeDuration <= 0) return;
      const rect = element.getBoundingClientRect();
      const percent = Math.max(
        0,
        Math.min(1, (event.clientX - rect.left) / rect.width),
      );
      setHoverPercent(percent);
    },
    [safeDuration],
  );

  function commitSeek(value: number) {
    const clamped =
      safeDuration > 0 ? Math.max(0, Math.min(safeDuration, value)) : 0;
    setDraftTime(clamped);
    onSeek(clamped);
  }

  function beginScrubbing() {
    setDraftTime(currentTime);
    setIsScrubbing(true);
  }

  function endScrubbing() {
    setDraftTime(null);
    setIsScrubbing(false);
  }

  return {
    safeDuration,
    displayedTime,
    progress,
    hoverPercent,
    hoverTime,
    trackRef,
    sliderStyle,
    glowTrackClass: thin ? "h-[3px]" : "h-1",
    glowWidthStyle: { width: `${progress}%` },
    glowLeftStyle: { left: `calc(${progress}% - 4px)` },
    beginScrubbing,
    endScrubbing,
    handleHover,
    clearHover: () => setHoverPercent(null),
    stopPropagation: stopEventPropagation,
    commitSeek,
  };
}

function SeekBarTimes({
  displayedTime,
  safeDuration,
}: Pick<SeekBarModel, "displayedTime" | "safeDuration">) {
  return (
    <div className="flex items-center justify-between text-[11px] tabular-nums text-text-muted">
      <span>{formatPlayerTime(displayedTime)}</span>
      <span>{formatPlayerTime(safeDuration)}</span>
    </div>
  );
}

function SeekBarTooltip({
  hoverPercent,
  hoverTime,
  className,
}: Pick<SeekBarModel, "hoverPercent" | "hoverTime"> & {
  className: string;
}) {
  if (hoverTime == null || hoverPercent == null) return null;
  return (
    <div
      className={`listen-player-progress-tooltip pointer-events-none absolute -translate-x-1/2 rounded border px-1.5 py-0.5 text-[10px] tabular-nums ${className}`}
      style={{ left: `${hoverPercent * 100}%` }}
    >
      {hoverTime}
    </div>
  );
}

function SeekBarFrame({
  className,
  showTimes,
  disabled,
  model,
  children,
}: {
  className: string;
  showTimes: boolean;
  disabled: boolean;
  model: SeekBarModel;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${className} ${showTimes ? "space-y-1.5" : ""} ${
        disabled ? "grayscale opacity-50" : ""
      }`}
      role="presentation"
      onClick={model.stopPropagation}
      onKeyDown={model.stopPropagation}
      onPointerDown={model.stopPropagation}
      onTouchStart={model.stopPropagation}
    >
      {showTimes ? (
        <SeekBarTimes
          displayedTime={model.displayedTime}
          safeDuration={model.safeDuration}
        />
      ) : null}
      {children}
    </div>
  );
}

function SeekInput({
  model,
  disabled,
  className,
  style,
  onPointerDown,
}: {
  model: SeekBarModel;
  disabled: boolean;
  className: string;
  style?: React.CSSProperties;
  onPointerDown?: (event: PointerEvent<HTMLInputElement>) => void;
}) {
  const { t } = useTranslation();
  return (
    <input
      type="range"
      min={0}
      max={model.safeDuration || 1}
      step={0.1}
      value={
        model.safeDuration > 0
          ? Math.min(model.displayedTime, model.safeDuration)
          : 0
      }
      disabled={disabled || model.safeDuration <= 0}
      aria-label={t("player.seek")}
      className={className}
      style={style}
      onPointerDown={(event) => {
        model.stopPropagation(event);
        model.beginScrubbing();
        onPointerDown?.(event);
      }}
      onPointerUp={(event) => {
        model.stopPropagation(event);
        model.endScrubbing();
      }}
      onTouchEnd={(event) => {
        model.stopPropagation(event);
        model.endScrubbing();
      }}
      onBlur={model.endScrubbing}
      onChange={(event) => model.commitSeek(Number(event.target.value || 0))}
    />
  );
}

function GlowSeekBar({
  className,
  showTimes,
  disabled,
  model,
}: {
  className: string;
  showTimes: boolean;
  disabled: boolean;
  model: SeekBarModel;
}) {
  return (
    <SeekBarFrame
      className={className}
      showTimes={showTimes}
      disabled={disabled}
      model={model}
    >
      <div
        ref={model.trackRef}
        className="listen-player-progress group relative py-3"
        onPointerMove={model.handleHover}
        onPointerLeave={model.clearHover}
      >
        <SeekBarTooltip
          hoverPercent={model.hoverPercent}
          hoverTime={model.hoverTime}
          className="-top-6"
        />
        <div
          className={`listen-player-progress-track absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full ${model.glowTrackClass}`}
        />
        <div
          className="pointer-events-none absolute left-0 top-1/2 h-3 -translate-y-1/2 overflow-hidden rounded-full opacity-65 transition-[width] duration-150"
          style={model.glowWidthStyle}
        >
          <div className="listen-player-progress-glow absolute inset-0 blur-[3px]" />
          <div className="listen-player-progress-fill absolute inset-y-[5px] inset-x-0 rounded-full" />
        </div>
        <div
          className={`listen-player-progress-fill absolute left-0 top-1/2 -translate-y-1/2 rounded-full transition-[width] duration-150 ${model.glowTrackClass}`}
          style={model.glowWidthStyle}
        />
        <div
          className="listen-player-progress-thumb pointer-events-none absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full transition-[left,opacity] duration-150"
          style={{
            ...model.glowLeftStyle,
            opacity: model.progress > 0 ? 0.62 : 0,
          }}
        />
        <div
          className="listen-player-progress-thumb-active absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border opacity-0 transition-[left,opacity] duration-150 group-hover:opacity-100"
          style={{ left: `calc(${model.progress}% - 5px)` }}
        />
        <SeekInput
          model={model}
          disabled={disabled}
          className="absolute inset-x-0 top-1/2 h-8 -translate-y-1/2 cursor-pointer opacity-0 disabled:cursor-default"
        />
      </div>
    </SeekBarFrame>
  );
}

function DefaultSeekBar({
  className,
  compact,
  thin,
  showTimes,
  disabled,
  model,
}: {
  className: string;
  compact: boolean;
  thin: boolean;
  showTimes: boolean;
  disabled: boolean;
  model: SeekBarModel;
}) {
  return (
    <SeekBarFrame
      className={className}
      showTimes={showTimes}
      disabled={disabled}
      model={model}
    >
      <div
        ref={model.trackRef}
        className="relative"
        onPointerMove={model.handleHover}
        onPointerLeave={model.clearHover}
      >
        <SeekBarTooltip
          hoverPercent={model.hoverPercent}
          hoverTime={model.hoverTime}
          className="-top-8"
        />
        <SeekInput
          model={model}
          disabled={disabled}
          className={`block w-full appearance-none rounded-full border-0 outline-none ${
            thin ? "h-1" : compact ? "h-1.5" : "h-2"
          } cursor-pointer disabled:cursor-default disabled:opacity-50`}
          style={model.sliderStyle}
        />
      </div>
    </SeekBarFrame>
  );
}

export function PlayerSeekBar({
  currentTime,
  duration,
  onSeek,
  compact = false,
  thin = false,
  showTimes = false,
  className = "",
  variant = "default",
  disabled = false,
}: PlayerSeekBarProps) {
  const model = useSeekBarModel(currentTime, duration, thin, onSeek);

  return variant === "glow" ? (
    <GlowSeekBar
      className={className}
      showTimes={showTimes}
      disabled={disabled}
      model={model}
    />
  ) : (
    <DefaultSeekBar
      className={className}
      compact={compact}
      thin={thin}
      showTimes={showTimes}
      disabled={disabled}
      model={model}
    />
  );
}
