import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [draftTime, setDraftTime] = useState(0);
  const [hoverPercent, setHoverPercent] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  useEffect(() => {
    if (!isScrubbing) {
      setDraftTime(currentTime);
    }
  }, [currentTime, isScrubbing]);

  const displayedTime = isScrubbing ? draftTime : currentTime;
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
  const glowTrackClass = thin ? "h-[3px]" : "h-1";
  const glowWidthStyle = { width: `${progress}%` };
  const glowLeftStyle = { left: `calc(${progress}% - 4px)` };

  const handleHover = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = trackRef.current;
      if (!el || safeDuration <= 0) return;
      const rect = el.getBoundingClientRect();
      const pct = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width),
      );
      setHoverPercent(pct);
    },
    [safeDuration],
  );

  function stopPropagation(event: React.SyntheticEvent) {
    event.stopPropagation();
  }

  function commitSeek(value: number) {
    const clamped =
      safeDuration > 0 ? Math.max(0, Math.min(safeDuration, value)) : 0;
    setDraftTime(clamped);
    onSeek(clamped);
  }

  if (variant === "glow") {
    return (
      <div
        className={`${className} ${showTimes ? "space-y-1.5" : ""} ${
          disabled ? "grayscale opacity-50" : ""
        }`}
        onClick={stopPropagation}
        onPointerDown={stopPropagation}
        onTouchStart={stopPropagation}
      >
        {showTimes ? (
          <div className="flex items-center justify-between text-[11px] tabular-nums text-text-muted">
            <span>{formatPlayerTime(displayedTime)}</span>
            <span>{formatPlayerTime(safeDuration)}</span>
          </div>
        ) : null}

        <div
          ref={trackRef}
          className="listen-player-progress group relative py-3"
          onPointerMove={handleHover}
          onPointerLeave={() => setHoverPercent(null)}
        >
          {hoverTime != null && hoverPercent != null && (
            <div
              className="listen-player-progress-tooltip pointer-events-none absolute -top-6 -translate-x-1/2 rounded border px-1.5 py-0.5 text-[10px] tabular-nums"
              style={{ left: `${hoverPercent * 100}%` }}
            >
              {hoverTime}
            </div>
          )}
          <div
            className={`listen-player-progress-track absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full ${glowTrackClass}`}
          />
          <div
            className="pointer-events-none absolute left-0 top-1/2 h-3 -translate-y-1/2 overflow-hidden rounded-full opacity-65 transition-[width] duration-150"
            style={glowWidthStyle}
          >
            <div className="listen-player-progress-glow absolute inset-0 blur-[3px]" />
            <div className="listen-player-progress-fill absolute inset-y-[5px] inset-x-0 rounded-full" />
          </div>
          <div
            className={`listen-player-progress-fill absolute left-0 top-1/2 -translate-y-1/2 rounded-full transition-[width] duration-150 ${glowTrackClass}`}
            style={glowWidthStyle}
          />
          <div
            className="listen-player-progress-thumb pointer-events-none absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full transition-[left,opacity] duration-150"
            style={{
              ...glowLeftStyle,
              opacity: progress > 0 ? 0.62 : 0,
            }}
          />
          <div
            className="listen-player-progress-thumb-active absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border opacity-0 transition-[left,opacity] duration-150 group-hover:opacity-100"
            style={{ left: `calc(${progress}% - 5px)` }}
          />
          <input
            type="range"
            min={0}
            max={safeDuration || 1}
            step={0.1}
            value={safeDuration > 0 ? Math.min(displayedTime, safeDuration) : 0}
            disabled={disabled || safeDuration <= 0}
            aria-label={t("player.seek")}
            className="absolute inset-x-0 top-1/2 h-8 -translate-y-1/2 cursor-pointer opacity-0 disabled:cursor-default"
            onPointerDown={(event) => {
              stopPropagation(event);
              setIsScrubbing(true);
            }}
            onPointerUp={(event) => {
              stopPropagation(event);
              setIsScrubbing(false);
            }}
            onTouchEnd={(event) => {
              stopPropagation(event);
              setIsScrubbing(false);
            }}
            onBlur={() => setIsScrubbing(false)}
            onChange={(event) => {
              const value = Number(event.target.value || 0);
              setDraftTime(value);
              commitSeek(value);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${className} ${showTimes ? "space-y-1.5" : ""} ${
        disabled ? "grayscale opacity-50" : ""
      }`}
      onClick={stopPropagation}
      onPointerDown={stopPropagation}
      onTouchStart={stopPropagation}
    >
      {showTimes ? (
        <div className="flex items-center justify-between text-[11px] tabular-nums text-text-muted">
          <span>{formatPlayerTime(displayedTime)}</span>
          <span>{formatPlayerTime(safeDuration)}</span>
        </div>
      ) : null}

      <div
        ref={trackRef}
        className="relative"
        onPointerMove={handleHover}
        onPointerLeave={() => setHoverPercent(null)}
      >
        {hoverTime != null && hoverPercent != null && (
          <div
            className="listen-player-progress-tooltip pointer-events-none absolute -top-8 -translate-x-1/2 rounded border px-1.5 py-0.5 text-[10px] tabular-nums"
            style={{ left: `${hoverPercent * 100}%` }}
          >
            {hoverTime}
          </div>
        )}
        <input
          type="range"
          min={0}
          max={safeDuration || 1}
          step={0.1}
          value={safeDuration > 0 ? Math.min(displayedTime, safeDuration) : 0}
          disabled={disabled || safeDuration <= 0}
          aria-label={t("player.seek")}
          className={`block w-full appearance-none rounded-full border-0 outline-none ${
            thin ? "h-1" : compact ? "h-1.5" : "h-2"
          } cursor-pointer disabled:cursor-default disabled:opacity-50`}
          style={sliderStyle}
          onPointerDown={(event) => {
            stopPropagation(event);
            setIsScrubbing(true);
          }}
          onPointerUp={(event) => {
            stopPropagation(event);
            setIsScrubbing(false);
          }}
          onTouchEnd={(event) => {
            stopPropagation(event);
            setIsScrubbing(false);
          }}
          onBlur={() => setIsScrubbing(false)}
          onChange={(event) => {
            const value = Number(event.target.value || 0);
            setDraftTime(value);
            commitSeek(value);
          }}
        />
      </div>
    </div>
  );
}
