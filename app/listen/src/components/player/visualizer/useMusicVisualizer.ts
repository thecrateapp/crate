import { useEffect, useRef, type MutableRefObject } from "react";
import { MusicVisualizer } from "./MusicVisualizer";
import { createAnalyserNode } from "@/hooks/use-audio-visualizer";
import { getAnalyserNode } from "@/lib/gapless-player";
import type { VisualizerMode } from "@/lib/player-visualizer-prefs";
import type { VisualizerQualityProfileName } from "./visualizer-quality";

function dbg(msg: string) {
  const d = document.getElementById("viz-debug");
  if (d) d.textContent = msg;
}

export function useMusicVisualizer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  trackKey: string | undefined,
  active: boolean,
  playbackState: { volume: number; isPlaying: boolean },
  mode: VisualizerMode = "spheres",
  externalVizRef?: MutableRefObject<MusicVisualizer | null>,
  qualityProfile: VisualizerQualityProfileName = "default",
) {
  const internalVizRef = useRef<MusicVisualizer | null>(null);
  const vizRef = externalVizRef ?? internalVizRef;
  const playbackStateRef = useRef(playbackState);
  const rendererQualityProfileRef = useRef(qualityProfile);

  useEffect(() => {
    playbackStateRef.current = playbackState;
  }, [playbackState]);

  useEffect(() => {
    if (rendererQualityProfileRef.current !== qualityProfile) {
      const previous = vizRef.current;
      if (previous) {
        previous.destroy();
        if (vizRef.current === previous) vizRef.current = null;
      }
      rendererQualityProfileRef.current = qualityProfile;
    }

    if (!active || !canvasRef.current) {
      vizRef.current?.stop();
      dbg(
        `off: active=${active} canvas=${!!canvasRef.current} analyser=${!!getAnalyserNode()}`,
      );
      return;
    }

    const canvas = canvasRef.current;
    let cancelled = false;
    let attempts = 0;
    const timeoutIds = new Set<number>();
    const animationFrameIds = new Set<number>();
    let tryInit = () => {};

    const scheduleTimeout = (callback: () => void, delay: number) => {
      const id = window.setTimeout(() => {
        timeoutIds.delete(id);
        callback();
      }, delay);
      timeoutIds.add(id);
      return id;
    };

    const scheduleAnimationFrame = (callback: () => void) => {
      const id = window.requestAnimationFrame(() => {
        animationFrameIds.delete(id);
        callback();
      });
      animationFrameIds.add(id);
      return id;
    };

    const syncRenderActivity = () => {
      const shouldRender =
        active &&
        document.visibilityState !== "hidden" &&
        canvas.clientWidth > 0 &&
        canvas.clientHeight > 0;
      const visualizer = vizRef.current;
      if (!shouldRender) {
        visualizer?.stop();
      } else if (visualizer) {
        visualizer.start();
      } else {
        tryInit();
      }
    };

    tryInit = () => {
      if (cancelled) return;
      if (document.visibilityState === "hidden") return;
      attempts++;

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;

      if (!w || !h) {
        dbg(`attempt ${attempts}: ${w}x${h} waiting...`);
        if (attempts < 50) scheduleAnimationFrame(tryInit);
        return;
      }

      const node = createAnalyserNode(2048);
      if (!node) {
        dbg(`attempt ${attempts}: no analyser, retrying`);
        if (attempts < 50) scheduleTimeout(tryInit, 200);
        return;
      }

      if (vizRef.current) {
        syncRenderActivity();
        dbg(`restarted ${w}x${h}`);
        return;
      }

      const forceResize = (viz: MusicVisualizer) => {
        const origW = canvas.style.width;
        canvas.style.width = canvas.clientWidth - 1 + "px";
        scheduleAnimationFrame(() => {
          canvas.style.width = origW;
          scheduleAnimationFrame(() => {
            const cw = canvas.clientWidth;
            const ch = canvas.clientHeight;
            if (cw > 0 && ch > 0) viz.setSize(cw, ch);
          });
        });
      };

      try {
        const viz = new MusicVisualizer(
          canvas,
          node,
          () => playbackStateRef.current,
          mode,
          qualityProfile,
        );
        vizRef.current = viz;
        syncRenderActivity();
        scheduleTimeout(() => forceResize(viz), 100);
        dbg(`created ${w}x${h}`);
      } catch (e) {
        dbg(`FAIL: ${e}`);
      }
    };

    // Small delay to let the DOM settle after display:none → visible
    scheduleTimeout(tryInit, 50);
    document.addEventListener("visibilitychange", syncRenderActivity);
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(syncRenderActivity);
    resizeObserver?.observe(canvas);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", syncRenderActivity);
      resizeObserver?.disconnect();
      for (const id of timeoutIds) window.clearTimeout(id);
      timeoutIds.clear();
      for (const id of animationFrameIds) {
        window.cancelAnimationFrame(id);
      }
      animationFrameIds.clear();
    };
  }, [active, canvasRef, externalVizRef, mode, qualityProfile]);

  useEffect(() => {
    if (!active || !vizRef.current) return;
    const node = createAnalyserNode(2048);
    if (node) vizRef.current.setAnalyser(node);
    vizRef.current.setMode(mode);
  }, [active, externalVizRef, mode, trackKey]);

  useEffect(
    () => () => {
      const ownedVisualizer = vizRef.current;
      if (!ownedVisualizer) return;
      ownedVisualizer.destroy();
      if (vizRef.current === ownedVisualizer) vizRef.current = null;
    },
    [vizRef],
  );

  return vizRef;
}
