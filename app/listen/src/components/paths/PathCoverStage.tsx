import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ComponentProps,
} from "react";
import { Music2 } from "@crate/ui/icons";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { useMotionAllowed } from "@crate/ui/lib/motion-gate";
import {
  getUiPreferences,
  subscribeUiPreferences,
} from "@crate/ui/lib/interface-preferences";
import {
  PATH_COVER_BLUR,
  PATH_COVER_TRANSITION_MS,
  coverPreloadWindow,
  medianStepDistance,
  pathStepJump,
  peakCells,
  retargetTransition,
  transitionDirection,
  type PathCoverStep,
} from "./path-cover-journey-model";
import {
  CoverBitmapCache,
  dominantCoverColor,
  type CoverLoader,
} from "./path-cover-textures";
import type { PathCoverTransitionRenderer } from "./path-cover-transition-renderer";

const effectsEnabled = () => getUiPreferences().effects !== "off";
const COVER_DECODE_WAIT_MS = 250;

/**
 * The inspected cover at rest is a plain MediaCover; a WebGL2 canvas overlays it only while a
 * pixelate-blur transition runs. Without WebGL2, textures, effects or motion it degrades to a
 * CSS fade-in, or to an instant swap when motion is blocked.
 */
export function PathCoverStage({
  steps,
  focus,
  loadCover,
  renderImage,
}: {
  steps: PathCoverStep[];
  focus: number;
  loadCover?: CoverLoader;
  renderImage?: ComponentProps<typeof MediaCover>["renderImage"];
}) {
  const motion = useMotionAllowed();
  const effects = useSyncExternalStore(
    subscribeUiPreferences,
    effectsEnabled,
    () => true,
  );
  const [shown, setShown] = useState(focus);
  const [transitioning, setTransitioning] = useState(false);
  const [glow, setGlow] = useState<string | null>(null);
  // React owns the overlay as the frame's last child, so remounted covers never stack above it.
  const overlay = useRef<HTMLDivElement>(null);
  const renderer = useRef<PathCoverTransitionRenderer | null>(null);
  const running = useRef<{ from: number; to: number; peak: number } | null>(
    null,
  );
  const shownIndex = useRef(focus);
  const request = useRef(0);
  const cache = useMemo(
    () => (loadCover ? new CoverBitmapCache(loadCover) : null),
    [loadCover],
  );
  const median = useMemo(() => medianStepDistance(steps), [steps]);
  const webgl = Boolean(cache) && motion && effects;
  useEffect(() => () => cache?.clear(), [cache]);
  // Drop a cover still decoding when the stage unmounts.
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  useEffect(() => {
    const host = overlay.current;
    if (!webgl || !host || typeof WebGL2RenderingContext === "undefined")
      return;
    // A fresh canvas per renderer: a disposed canvas keeps its lost context.
    const canvas = document.createElement("canvas");
    canvas.className = "path-cover-canvas";
    canvas.setAttribute("aria-hidden", "true");
    host.append(canvas);
    let instance: PathCoverTransitionRenderer | null = null;
    let disposed = false;
    const reset = () => {
      running.current = null;
      setTransitioning(false);
    };
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        instance?.resize(entry.contentRect.width, entry.contentRect.height);
    });
    void import("./path-cover-transition-renderer").then(
      ({ PathCoverTransitionRenderer }) => {
        if (disposed) return;
        try {
          instance = new PathCoverTransitionRenderer(canvas, {
            onLost: () => {
              renderer.current = null;
              reset();
            },
            onRestored: () => {
              renderer.current = instance;
            },
          });
        } catch {
          canvas.remove();
          return;
        }
        renderer.current = instance;
        instance.resize(host.clientWidth, host.clientHeight);
        observer.observe(host);
      },
    );
    return () => {
      disposed = true;
      observer.disconnect();
      renderer.current = null;
      instance?.dispose();
      canvas.remove();
      reset();
    };
  }, [webgl]);
  useEffect(() => {
    if (!cache) return;
    for (const index of coverPreloadWindow(steps.length, focus)) {
      const url = steps[index]?.coverUrl;
      if (url) void cache.request(url);
    }
  }, [cache, focus, steps]);
  const focusUrl = steps[focus]?.coverUrl;
  useEffect(() => {
    if (!cache || !effects || !focusUrl) {
      setGlow(null);
      return;
    }
    let current = true;
    void cache.request(focusUrl).then((bitmap) => {
      if (!current) return;
      try {
        setGlow(bitmap ? dominantCoverColor(bitmap) : null);
      } catch {
        setGlow(null);
      }
    });
    return () => {
      current = false;
    };
  }, [cache, effects, focusUrl]);
  useEffect(() => {
    // Every change supersedes a cover still waiting to decode.
    const ticket = ++request.current;
    const instance = renderer.current;
    const active = running.current;
    if (focus < 0 || focus >= steps.length) return;
    if (active ? focus === active.to : focus === shownIndex.current) return;
    const show = () => {
      shownIndex.current = focus;
      setShown(focus);
    };
    const swap = () => {
      instance?.cancel();
      running.current = null;
      setTransitioning(false);
      show();
    };
    const progress = instance?.progress;
    const retarget = active && progress != null;
    const { from, startT } = retarget
      ? retargetTransition({ ...active, t: progress }, focus)
      : { from: shownIndex.current, startT: 0 };
    // An interrupted mosaic keeps its grain instead of snapping to the new jump's peak.
    const peak = retarget
      ? active.peak
      : peakCells(pathStepJump(steps, from, focus, median));
    const fromUrl = steps[from]?.coverUrl,
      toUrl = steps[focus]?.coverUrl;
    const fromBitmap = fromUrl ? cache?.peek(fromUrl) : undefined;
    if (!cache || !toUrl || !fromBitmap || !motion || !instance?.available) {
      swap();
      return;
    }
    const start = (toBitmap: ImageBitmap) => {
      const target = { from, to: focus, peak };
      let run: Promise<"done" | "cancelled">;
      try {
        run = instance.run({
          from: fromBitmap,
          to: toBitmap,
          dir: transitionDirection(from, focus),
          peak,
          blur: PATH_COVER_BLUR,
          startT,
          durationMs: PATH_COVER_TRANSITION_MS,
        });
      } catch {
        swap();
        return;
      }
      running.current = target;
      show();
      setTransitioning(true);
      void run.then((end) => {
        if (end !== "done" || running.current !== target) return;
        running.current = null;
        setTransitioning(false);
      });
    };
    const ready = cache.peek(toUrl);
    if (ready) {
      start(ready);
      return;
    }
    // A distant step may still be decoding: hold the current cover briefly rather than
    // skipping the transition, then fall back to the fade.
    const timer = window.setTimeout(() => {
      if (request.current !== ticket) return;
      request.current++;
      swap();
    }, COVER_DECODE_WAIT_MS);
    void cache.request(toUrl).then((bitmap) => {
      if (request.current !== ticket) return;
      window.clearTimeout(timer);
      if (bitmap && renderer.current === instance && instance.available)
        start(bitmap);
      else swap();
    });
  }, [focus]);
  const step = steps[Math.min(shown, steps.length - 1)];
  return (
    <div
      className="path-cover-stage"
      data-slot="path-cover-stage"
      style={{ "--path-cover-glow": glow ?? "transparent" } as CSSProperties}
    >
      <div
        className="path-cover-frame"
        data-transitioning={transitioning || undefined}
      >
        {step ? (
          <MediaCover
            key={`${shown}:${step.coverUrl ?? ""}`}
            src={step.coverUrl}
            alt=""
            fallbackIcon={Music2}
            size="fill"
            className="path-cover-art"
            renderImage={renderImage}
          />
        ) : null}
        <div ref={overlay} className="path-cover-overlay" />
      </div>
    </div>
  );
}
