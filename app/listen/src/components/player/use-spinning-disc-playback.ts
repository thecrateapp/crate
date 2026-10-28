import { useCallback, useEffect, useRef } from "react";
import { DISC_DEGREES_PER_SECOND } from "./spinning-disc-math";
import {
  isMotionBlocked,
  subscribeToMotionAvailability,
} from "../../lib/motion-availability";

interface UseSpinningDiscPlaybackOptions {
  currentTime: number;
  dragRotation: number | null;
  duration: number;
  isBuffering: boolean;
  isJogging: boolean;
  isPlaying: boolean;
}

const now = () => performance.now();
const SEEK_DISCONTINUITY_SECONDS = 2;

export function useSpinningDiscPlayback(
  options: UseSpinningDiscPlaybackOptions,
) {
  const { currentTime, dragRotation, isBuffering, isJogging, isPlaying } =
    options;
  const rotorRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<Animation | null>(null);
  const frameRef = useRef<number | null>(null);
  const rotationRef = useRef(currentTime * DISC_DEGREES_PER_SECOND);
  const lastFrameRef = useRef(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const sampleRef = useRef({
    time: currentTime,
    timestamp: now(),
    isPlaying,
    isBuffering,
  });
  const pendingAnchorRef = useRef<{ time: number; expires: number } | null>(
    null,
  );

  const writeRotation = useCallback(() => {
    if (rotorRef.current) {
      rotorRef.current.style.transform = `translate3d(0, 0, 0) rotate(${rotationRef.current}deg)`;
    }
  }, []);
  const getRotorRotation = useCallback(() => {
    const elapsed = animationRef.current?.currentTime;
    return (
      rotationRef.current +
      (typeof elapsed === "number"
        ? (elapsed * DISC_DEGREES_PER_SECOND) / 1000
        : 0)
    );
  }, []);
  const stopMotion = useCallback(() => {
    rotationRef.current = getRotorRotation();
    animationRef.current?.cancel();
    animationRef.current = null;
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    writeRotation();
  }, [getRotorRotation, writeRotation]);
  const setRotorRotation = useCallback(
    (rotation: number) => {
      stopMotion();
      rotationRef.current = rotation;
      writeRotation();
    },
    [stopMotion, writeRotation],
  );
  const setPlaybackAnchor = useCallback((time: number) => {
    const timestamp = now();
    sampleRef.current = {
      time,
      timestamp,
      isPlaying: optionsRef.current.isPlaying,
      isBuffering: optionsRef.current.isBuffering,
    };
    pendingAnchorRef.current = { time, expires: timestamp + 2000 };
  }, []);

  const startMotion = useCallback(() => {
    const state = optionsRef.current;
    if (
      !state.isPlaying ||
      state.isBuffering ||
      state.isJogging ||
      state.dragRotation != null ||
      isMotionBlocked()
    )
      return;
    if (animationRef.current || frameRef.current != null) return;
    writeRotation();
    const rotor = rotorRef.current;
    if (rotor && typeof rotor.animate === "function") {
      // The compositor keeps rotation moving while progress notifications or other JS work run.
      const start = rotationRef.current;
      animationRef.current = rotor.animate(
        [
          { transform: `translate3d(0, 0, 0) rotate(${start}deg)` },
          { transform: `translate3d(0, 0, 0) rotate(${start + 360}deg)` },
        ],
        {
          duration: (360 / DISC_DEGREES_PER_SECOND) * 1000,
          iterations: Infinity,
          easing: "linear",
        },
      );
      return;
    }
    // Older engines retain one ref-based RAF loop, independent of media-clock granularity.
    lastFrameRef.current = now();
    const tick = (timestamp: number) => {
      rotationRef.current +=
        (Math.max(0, timestamp - lastFrameRef.current) *
          DISC_DEGREES_PER_SECOND) /
        1000;
      lastFrameRef.current = timestamp;
      writeRotation();
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [writeRotation]);

  useEffect(() => {
    if (isJogging || dragRotation != null) return;
    const timestamp = now();
    const pending = pendingAnchorRef.current;
    if (pending) {
      if (
        Math.abs(currentTime - pending.time) > 0.5 &&
        timestamp < pending.expires
      )
        return;
      pendingAnchorRef.current = null;
      sampleRef.current = {
        time: currentTime,
        timestamp,
        isPlaying,
        isBuffering,
      };
      return;
    }
    const previous = sampleRef.current;
    if (currentTime === previous.time) return;
    const elapsed =
      previous.isPlaying && !previous.isBuffering
        ? (timestamp - previous.timestamp) / 1000
        : 0;
    const discontinuity = currentTime - previous.time - elapsed;
    sampleRef.current = {
      time: currentTime,
      timestamp,
      isPlaying,
      isBuffering,
    };
    // Genuine seeks reposition the disc. Ordinary coarse/drifting clock updates never snap it.
    if (Math.abs(discontinuity) > SEEK_DISCONTINUITY_SECONDS) {
      setRotorRotation(currentTime * DISC_DEGREES_PER_SECOND);
      startMotion();
    }
  }, [
    currentTime,
    dragRotation,
    isBuffering,
    isJogging,
    isPlaying,
    setRotorRotation,
    startMotion,
  ]);

  useEffect(() => {
    const state = optionsRef.current;
    const sample = sampleRef.current;
    if (sample.isPlaying !== isPlaying || sample.isBuffering !== isBuffering) {
      sampleRef.current = {
        time: state.currentTime,
        timestamp: now(),
        isPlaying,
        isBuffering,
      };
    }
    if (dragRotation != null) {
      setRotorRotation(dragRotation);
      return;
    }
    const syncMotion = () => {
      if (!isPlaying || isBuffering || isJogging || isMotionBlocked())
        stopMotion();
      else startMotion();
    };
    const unsubscribe = subscribeToMotionAvailability(syncMotion);
    syncMotion();
    return () => {
      unsubscribe();
      stopMotion();
    };
  }, [
    dragRotation,
    isBuffering,
    isJogging,
    isPlaying,
    setRotorRotation,
    startMotion,
    stopMotion,
  ]);

  return { rotorRef, getRotorRotation, setPlaybackAnchor, setRotorRotation };
}
