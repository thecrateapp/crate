import type { PointerEvent } from "react";
import { useTranslation } from "react-i18next";

import { formatPlayerTime } from "./player-bar-utils";

import { PlayerProgressBeam } from "./PlayerProgressBeam";

import type { SeekBarModel } from "./player-seek-bar-model";

export function SeekBarTimes({
  displayedTime,
  safeDuration,
  remaining = false,
}: Pick<SeekBarModel, "displayedTime" | "safeDuration"> & {
  remaining?: boolean;
}) {
  return (
    <div className="flex items-center justify-between font-mono text-xs tabular-nums text-text-muted">
      <span>{formatPlayerTime(displayedTime)}</span>
      <span>
        {remaining ? "-" : ""}
        {formatPlayerTime(
          remaining ? Math.max(0, safeDuration - displayedTime) : safeDuration,
        )}
      </span>
    </div>
  );
}

export function SeekBarTooltip({
  hoverPercent,
  hoverTime,
  className,
}: Pick<SeekBarModel, "hoverPercent" | "hoverTime"> & {
  className: string;
}) {
  if (hoverTime == null || hoverPercent == null) return null;
  return (
    <div
      className={`listen-player-progress-tooltip pointer-events-none absolute -translate-x-1/2 rounded border px-1.5 py-0.5 text-xs tabular-nums ${className}`}
      style={{ left: `${hoverPercent * 100}%` }}
    >
      {hoverTime}
    </div>
  );
}

function SeekBarFrame({
  className,
  showTimes,
  remaining = false,
  disabled,
  model,
  children,
}: {
  className: string;
  showTimes: boolean;
  remaining?: boolean;
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
          remaining={remaining}
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
      aria-valuenow={
        model.safeDuration > 0
          ? Math.max(0, Math.min(model.displayedTime, model.safeDuration))
          : 0
      }
      aria-valuetext={formatPlayerTime(model.displayedTime)}
      className={className}
      style={style}
      onKeyDown={(event) => {
        const changes: Record<string, number> = {
          ArrowLeft: model.displayedTime - 5,
          ArrowDown: model.displayedTime - 5,
          ArrowRight: model.displayedTime + 5,
          ArrowUp: model.displayedTime + 5,
          Home: 0,
          End: model.safeDuration,
        };
        const next = changes[event.key];
        if (next === undefined) return;
        event.preventDefault();
        model.commitSeek(Math.max(0, Math.min(model.safeDuration, next)));
      }}
      onPointerCancel={model.endScrubbing}
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

export function GlowSeekBar({
  compact = false,
  className,
  showTimes,
  remaining = false,
  disabled,
  model,
}: {
  compact?: boolean;
  className: string;
  showTimes: boolean;
  remaining?: boolean;
  disabled: boolean;
  model: SeekBarModel;
}) {
  return (
    <SeekBarFrame
      remaining={remaining}
      className={className}
      showTimes={showTimes}
      disabled={disabled}
      model={model}
    >
      <div
        ref={model.trackRef}
        data-compact={compact || undefined}
        className="listen-player-progress group relative py-3"
        onPointerMove={model.handleHover}
        onPointerLeave={model.clearHover}
      >
        <SeekBarTooltip
          hoverPercent={model.hoverPercent}
          hoverTime={model.hoverTime}
          className="-top-6"
        />
        <PlayerProgressBeam
          progressPercent={model.progress}
          trackClassName={model.glowTrackClass}
        />
        <SeekInput
          model={model}
          disabled={disabled}
          className="listen-player-progress-input absolute inset-0 w-full cursor-pointer opacity-0 disabled:cursor-default"
        />
      </div>
    </SeekBarFrame>
  );
}

export function DefaultSeekBar({
  className,
  compact,
  thin,
  showTimes,
  remaining = false,
  disabled,
  model,
}: {
  className: string;
  compact: boolean;
  thin: boolean;
  showTimes: boolean;
  remaining?: boolean;
  disabled: boolean;
  model: SeekBarModel;
}) {
  return (
    <SeekBarFrame
      remaining={remaining}
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
          className={`listen-player-seek-input block w-full appearance-none rounded-full border-0 outline-none ${
            thin ? "h-1" : compact ? "h-1.5" : "h-2"
          } cursor-pointer disabled:cursor-default disabled:opacity-50`}
          style={model.sliderStyle}
        />
      </div>
    </SeekBarFrame>
  );
}
