import { useCallback, useEffect, useRef, useState } from "react";
import { Disc3, Loader2, Pause, Play } from "lucide-react";

import { cn } from "@crate/ui/lib/cn";

const DISC_DEGREES_PER_SECOND = 120;
const JOG_SECONDS_PER_ROTATION = 2.5;
const JOG_SEEK_INTERVAL_MS = 110;
const JOG_RATE_UPDATE_INTERVAL_MS = 70;
const PLAYING_FORWARD_SYNC_TOLERANCE_SECONDS = 0.65;
const PLAYING_BACKWARD_SYNC_TOLERANCE_SECONDS = 1.6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getPointerAngle(
  event: Pick<PointerEvent, "clientX" | "clientY">,
  bounds: DOMRect,
): number {
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;
  return Math.atan2(event.clientY - centerY, event.clientX - centerX) * (180 / Math.PI);
}

function normalizeDeltaDegrees(delta: number): number {
  if (delta > 180) return delta - 360;
  if (delta < -180) return delta + 360;
  return delta;
}

interface SpinningDiscProps {
  albumCover?: string | null;
  className?: string;
  crossfadeIncomingCover?: string | null;
  crossfadeOutgoingCover?: string | null;
  crossfadeProgress?: number;
  currentTime: number;
  duration: number;
  isBuffering?: boolean;
  isPlaying: boolean;
  jogEnabled?: boolean;
  onJoggingChange?: (jogging: boolean) => void;
  onPlaybackRateChange?: (rate: number) => void;
  onSeek?: (time: number) => void;
  onTogglePlay: () => void;
}

export function SpinningDisc({
  albumCover,
  className,
  crossfadeIncomingCover,
  crossfadeOutgoingCover,
  crossfadeProgress = 0,
  currentTime,
  duration,
  isBuffering = false,
  isPlaying,
  jogEnabled = false,
  onJoggingChange,
  onPlaybackRateChange,
  onSeek,
  onTogglePlay,
}: SpinningDiscProps) {
  const discRef = useRef<HTMLDivElement>(null);
  const rotorRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const playbackAnchorRef = useRef({ time: currentTime, timestamp: 0 });
  const seekTimerRef = useRef<number | null>(null);
  const lastSeekFlushAtRef = useRef(0);
  const lastRateUpdateAtRef = useRef(0);
  const lastJogRateRef = useRef(1);
  const pendingSeekRef = useRef<number | null>(null);
  const dragStateRef = useRef<{
    accumDegrees: number;
    baseRotation: number;
    pointerId: number;
    previousAngle: number;
    previousMoveAt: number;
    startTime: number;
  } | null>(null);

  const [isJogging, setIsJogging] = useState(false);
  const [dragRotation, setDragRotation] = useState<number | null>(null);

  const showCrossfade = !!crossfadeOutgoingCover && !!crossfadeIncomingCover;

  const setJogPlaybackRate = useCallback((rate: number, immediate = false) => {
    if (!onPlaybackRateChange) return;
    const safeRate = clamp(rate, 0.25, 4);
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (
      !immediate &&
      now - lastRateUpdateAtRef.current < JOG_RATE_UPDATE_INTERVAL_MS &&
      Math.abs(safeRate - lastJogRateRef.current) < 0.12
    ) {
      return;
    }
    lastRateUpdateAtRef.current = now;
    lastJogRateRef.current = safeRate;
    onPlaybackRateChange(safeRate);
  }, [onPlaybackRateChange]);

  const setRotorRotation = useCallback((rotation: number) => {
    if (!rotorRef.current) return;
    rotorRef.current.style.transform = `rotate(${rotation}deg)`;
  }, []);

  const projectedPlaybackTime = useCallback((timestamp: number) => {
    const anchor = playbackAnchorRef.current;
    if (!isPlaying || isBuffering) return anchor.time;
    const elapsedSeconds = Math.max(0, (timestamp - anchor.timestamp) / 1000);
    const projected = anchor.time + elapsedSeconds;
    return duration > 0 ? Math.min(projected, duration) : projected;
  }, [duration, isBuffering, isPlaying]);

  const clearSeekTimer = useCallback(() => {
    if (seekTimerRef.current == null) return;
    window.clearTimeout(seekTimerRef.current);
    seekTimerRef.current = null;
  }, []);

  const flushPendingSeek = useCallback(() => {
    if (!onSeek) return;
    clearSeekTimer();
    const pending = pendingSeekRef.current;
    pendingSeekRef.current = null;
    if (pending == null) return;
    lastSeekFlushAtRef.current = typeof performance !== "undefined" ? performance.now() : Date.now();
    onSeek(pending);
  }, [clearSeekTimer, onSeek]);

  const scheduleSeek = useCallback(
    (nextTime: number, immediate = false) => {
      if (!onSeek) return;
      pendingSeekRef.current = nextTime;
      if (immediate) {
        flushPendingSeek();
        return;
      }

      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const elapsed = now - lastSeekFlushAtRef.current;
      if (elapsed >= JOG_SEEK_INTERVAL_MS) {
        flushPendingSeek();
        return;
      }

      if (seekTimerRef.current != null) return;
      seekTimerRef.current = window.setTimeout(flushPendingSeek, JOG_SEEK_INTERVAL_MS - elapsed);
    },
    [flushPendingSeek, onSeek],
  );

  useEffect(() => {
    onJoggingChange?.(isJogging);
  }, [isJogging, onJoggingChange]);

  useEffect(() => {
    return () => {
      onJoggingChange?.(false);
    };
  }, [onJoggingChange]);

  useEffect(() => {
    return () => {
      clearSeekTimer();
      onPlaybackRateChange?.(1);
      if (animationFrameRef.current != null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [clearSeekTimer, onPlaybackRateChange]);

  useEffect(() => {
    if (isJogging || dragRotation != null) return;

    const timestamp = typeof performance !== "undefined" ? performance.now() : Date.now();
    const projected = projectedPlaybackTime(timestamp);
    const drift = currentTime - projected;
    const shouldHardSync =
      !isPlaying ||
      isBuffering ||
      drift > PLAYING_FORWARD_SYNC_TOLERANCE_SECONDS ||
      drift < -PLAYING_BACKWARD_SYNC_TOLERANCE_SECONDS;

    if (shouldHardSync) {
      playbackAnchorRef.current = { time: currentTime, timestamp };
      if (!isPlaying || isBuffering) {
        setRotorRotation(currentTime * DISC_DEGREES_PER_SECOND);
      }
    }
  }, [
    currentTime,
    dragRotation,
    isBuffering,
    isJogging,
    isPlaying,
    projectedPlaybackTime,
    setRotorRotation,
  ]);

  useEffect(() => {
    if (dragRotation != null) {
      setRotorRotation(dragRotation);
      return;
    }

    if (animationFrameRef.current != null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (!isPlaying || isBuffering) {
      const timestamp = typeof performance !== "undefined" ? performance.now() : Date.now();
      playbackAnchorRef.current = { time: currentTime, timestamp };
      setRotorRotation(currentTime * DISC_DEGREES_PER_SECOND);
      return;
    }

    const tick = (timestamp: number) => {
      const displayTime = projectedPlaybackTime(timestamp);
      setRotorRotation(displayTime * DISC_DEGREES_PER_SECOND);
      animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    animationFrameRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (animationFrameRef.current != null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [
    dragRotation,
    isBuffering,
    isPlaying,
    projectedPlaybackTime,
    setRotorRotation,
  ]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!jogEnabled || !onSeek || duration <= 0) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;

      const bounds = event.currentTarget.getBoundingClientRect();
      const angle = getPointerAngle(event.nativeEvent, bounds);
      const baseRotation = currentTime * DISC_DEGREES_PER_SECOND;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();

      dragStateRef.current = {
        accumDegrees: 0,
        baseRotation,
        pointerId: event.pointerId,
        previousAngle: angle,
        previousMoveAt: now,
        startTime: currentTime,
      };
      setJogPlaybackRate(1, true);
      setDragRotation(baseRotation);
      setIsJogging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [currentTime, duration, jogEnabled, onSeek, setJogPlaybackRate],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const dragState = dragStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) return;

      const bounds = event.currentTarget.getBoundingClientRect();
      const nextAngle = getPointerAngle(event.nativeEvent, bounds);
      const delta = normalizeDeltaDegrees(nextAngle - dragState.previousAngle);
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const elapsedMs = Math.max(16, now - dragState.previousMoveAt);
      dragState.previousAngle = nextAngle;
      dragState.previousMoveAt = now;
      dragState.accumDegrees += delta;

      const nextTime = clamp(
        dragState.startTime + (dragState.accumDegrees / 360) * JOG_SECONDS_PER_ROTATION,
        0,
        duration,
      );

      setDragRotation(dragState.baseRotation + dragState.accumDegrees);
      const degreesPerSecond = (delta / elapsedMs) * 1000;
      if (degreesPerSecond > 8) {
        setJogPlaybackRate(degreesPerSecond / DISC_DEGREES_PER_SECOND);
      } else if (degreesPerSecond < -8) {
        setJogPlaybackRate(0.35);
      } else {
        setJogPlaybackRate(1);
      }
      scheduleSeek(nextTime);
      event.preventDefault();
    },
    [duration, scheduleSeek, setJogPlaybackRate],
  );

  const finishJog = useCallback((pointerId: number, currentTarget: HTMLDivElement) => {
    const dragState = dragStateRef.current;
    if (!dragState || pointerId !== dragState.pointerId) return;
    const finalTime = pendingSeekRef.current ?? currentTime;
    flushPendingSeek();
    dragStateRef.current = null;
    setIsJogging(false);
    setDragRotation(null);
    setJogPlaybackRate(1, true);
    playbackAnchorRef.current = {
      time: finalTime,
      timestamp: typeof performance !== "undefined" ? performance.now() : Date.now(),
    };
    setRotorRotation(finalTime * DISC_DEGREES_PER_SECOND);
    if (currentTarget.hasPointerCapture(pointerId)) {
      currentTarget.releasePointerCapture(pointerId);
    }
  }, [currentTime, flushPendingSeek, setJogPlaybackRate, setRotorRotation]);

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      finishJog(event.pointerId, event.currentTarget);
    },
    [finishJog],
  );

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      finishJog(event.pointerId, event.currentTarget);
    },
    [finishJog],
  );

  return (
    <div className={cn("relative", className)}>
      <div className="absolute inset-[7%] rounded-full bg-primary/12 blur-3xl opacity-80" />
      <div
        ref={discRef}
        className={cn(
          "relative aspect-square w-full rounded-full border border-white/12 bg-[radial-gradient(circle_at_50%_40%,rgba(255,255,255,0.14),rgba(255,255,255,0.02)_26%,rgba(0,0,0,0.88)_68%,rgba(0,0,0,1))] shadow-[0_32px_90px_rgba(0,0,0,0.6),0_12px_32px_rgba(0,0,0,0.42)]",
          jogEnabled && onSeek ? "cursor-grab touch-none active:cursor-grabbing" : "",
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        style={{ touchAction: jogEnabled && onSeek ? "none" : undefined }}
      >
        <div
          ref={rotorRef}
          className={cn(
            "absolute inset-[5.5%] overflow-hidden rounded-full border border-white/10 bg-black/90 transition-transform duration-150",
            isJogging ? "" : "will-change-transform",
          )}
          style={{
            transition: isJogging || (isPlaying && !isBuffering) ? "none" : "transform 140ms linear",
          }}
        >
          {showCrossfade ? (
            <>
              <img
                src={crossfadeOutgoingCover!}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                style={{ opacity: 1 - crossfadeProgress }}
              />
              <img
                src={crossfadeIncomingCover!}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                style={{ opacity: crossfadeProgress }}
              />
            </>
          ) : albumCover ? (
            <img src={albumCover} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-white/5">
              <Disc3 size={88} className="text-white/12" />
            </div>
          )}

        </div>

        <div className="pointer-events-none absolute inset-[2%] rounded-full border border-white/8 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" />

        <button
          type="button"
          onClick={onTogglePlay}
          onPointerDown={(event) => event.stopPropagation()}
          className="absolute left-1/2 top-1/2 z-10 flex h-[26%] w-[26%] min-h-[72px] min-w-[72px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/14 bg-[radial-gradient(circle,rgba(15,23,42,0.96),rgba(2,6,12,0.98))] text-white shadow-[0_14px_34px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl transition-transform duration-200 hover:scale-[1.03] active:scale-[0.97]"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          <span className="absolute inset-[10%] rounded-full border border-primary/18" />
          {isBuffering ? (
            <Loader2 size={22} className="animate-spin text-primary" />
          ) : isPlaying ? (
            <Pause size={22} className="text-white" />
          ) : (
            <Play size={22} className="translate-x-[2px] fill-white text-white" />
          )}
        </button>
      </div>
    </div>
  );
}
