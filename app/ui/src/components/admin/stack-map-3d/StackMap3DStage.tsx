import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { useMotionAllowed } from "@crate/ui/lib/motion-gate";
import {
  getServiceRelations,
  serviceHealth,
  type StackMapSnapshot,
} from "../stack-map-model";
import type { StackActivityView } from "../stack-map-activity";
import {
  buildScene3D,
  dotState,
  gaugeTip,
  scheduleBeams,
  schedulePulses,
  type Node3D,
  type ScheduledDot,
  type Vec3,
} from "./stack-map-3d-model";
import {
  createOrbitController,
  defaultCamera,
  fitDistance,
  project,
  projectionFor,
  topDownCamera,
  type CameraState,
  type OrbitController,
  type Projection,
} from "./stack-map-3d-camera";
import {
  placeLabels,
  preferredSide,
  type LabelCandidate,
  type Rect,
} from "./stack-map-3d-labels";
import {
  readStackMap3DTokens,
  type StackMap3DTokens,
} from "./stack-map-3d-tokens";
import type {
  Highlight,
  StackMapRenderer,
  VisibleDot,
} from "./stack-map-3d-renderer";
import createThreeRenderer from "./three-renderer";
import "./stack-map-3d.css";

export type StackMap3DUnavailableReason = "context-lost" | "failed";

export interface StackMap3DStageProps {
  snapshot: StackMapSnapshot;
  activityView: StackActivityView;
  selectedId: string | null;
  onSelect: (serviceId: string) => void;
  nodeRefs: MutableRefObject<Map<string, HTMLButtonElement>>;
  onUnavailable: (reason: StackMap3DUnavailableReason) => void;
}

const HALO_SCALE = { healthy: 1.1, unhealthy: 1.26, unknown: 1.14 } as const;

function numeric(value: number | null, suffix: string, digits = 0) {
  return value !== null && Number.isFinite(value)
    ? `${value.toFixed(digits)}${suffix}`
    : "n/a";
}

function rate(value: string | undefined) {
  const parsed = value ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function isBackFacing(node: Node3D, eye: Vec3) {
  if (node.ring === "hub") return false;
  return (
    node.normal[0] * (eye[0] - node.position[0]) +
      node.normal[1] * (eye[1] - node.position[1]) +
      node.normal[2] * (eye[2] - node.position[2]) <
    0
  );
}

function pixelRadius(projection: Projection, center: Vec3, radius: number) {
  const forward: Vec3 = [
    projection.target[0] - projection.eye[0],
    projection.target[1] - projection.eye[1],
    projection.target[2] - projection.eye[2],
  ];
  const up = projection.up;
  const right: Vec3 = [
    forward[1] * up[2] - forward[2] * up[1],
    forward[2] * up[0] - forward[0] * up[2],
    forward[0] * up[1] - forward[1] * up[0],
  ];
  const length = Math.hypot(...right) || 1;
  const a = project(projection, center);
  const b = project(projection, [
    center[0] + (right[0] / length) * radius,
    center[1] + (right[1] / length) * radius,
    center[2] + (right[2] / length) * radius,
  ]);
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export default function StackMap3DStage({
  snapshot,
  activityView,
  selectedId,
  onSelect,
  nodeRefs,
  onUnavailable,
}: StackMap3DStageProps) {
  const motionAllowed = useMotionAllowed();
  const stageRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const labelSizes = useRef(new Map<string, { w: number; h: number }>());
  const captionRefs = useRef(new Map<string, HTMLDivElement>());
  const controllerRef = useRef<OrbitController | null>(null);
  const rendererRef = useRef<StackMapRenderer | null>(null);
  const tokensRef = useRef<StackMap3DTokens | null>(null);
  const cameraRef = useRef<CameraState | null>(null);
  const requestRef = useRef<() => void>(() => {});
  const highlightRef = useRef<Highlight | null>(null);
  const levelsRef = useRef(activityView.levels);
  const pausedRef = useRef(false);
  const unavailableRef = useRef(onUnavailable);
  const pulseRunRef = useRef<{ start: number; dots: ScheduledDot[] } | null>(
    null,
  );
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [rendererState, setRendererState] = useState<"loading" | "ready">(
    "loading",
  );
  const [quality, setQuality] = useState<"full" | "reduced">("full");

  const scene = useMemo(() => buildScene3D(snapshot), [snapshot]);
  const health = useMemo(
    () =>
      new Map(
        snapshot.services.map((service) => [
          service.id,
          serviceHealth(snapshot, service),
        ]),
      ),
    [snapshot],
  );
  const servicesById = useMemo(
    () => new Map(snapshot.services.map((service) => [service.id, service])),
    [snapshot.services],
  );
  const previewId =
    [hoveredId, focusedId].find((id) => id && servicesById.has(id)) ?? null;
  const related = useMemo(
    () => getServiceRelations(snapshot, previewId ?? selectedId ?? ""),
    [snapshot, previewId, selectedId],
  );
  const highlight = useMemo<Highlight>(
    () => ({
      active: new Set(related.connections),
      live: new Set(activityView.pulses.map((pulse) => pulse.connection)),
      activeIds: related.activeIds,
      previewing: Boolean(previewId),
      selectedId,
      hoveredId: previewId,
    }),
    [related, activityView.pulses, previewId, selectedId],
  );

  useEffect(() => {
    highlightRef.current = highlight;
    levelsRef.current = activityView.levels;
    pausedRef.current = activityView.status === "paused";
    unavailableRef.current = onUnavailable;
    requestRef.current();
  }, [highlight, activityView, onUnavailable]);

  useEffect(() => {
    labelSizes.current.clear();
  }, [snapshot]);

  useEffect(() => {
    const stage = stageRef.current;
    const layer = layerRef.current;
    if (!stage || !layer) return;
    let disposed = false;
    let frame = 0;
    const tokens = readStackMap3DTokens(stage);
    tokensRef.current = tokens;
    const aspect = () => stage.clientWidth / Math.max(1, stage.clientHeight);

    const layoutOverlay = (projection: Projection) => {
      const current = highlightRef.current;
      if (!current) return;
      const domeScreens = new Map(
        scene.domes.map((dome) => [
          dome.id,
          project(projection, [dome.center[0], 0, dome.center[2]]),
        ]),
      );
      const candidates: LabelCandidate[] = [];
      const nodeRects = new Map<string, Rect>();
      const depths: { id: string; depth: number }[] = [];
      for (const [id, node] of scene.nodes) {
        const button = nodeRefs.current.get(id);
        if (!button) continue;
        const p = project(projection, node.position);
        button.style.left = `${p.x.toFixed(1)}px`;
        button.style.top = `${p.y.toFixed(1)}px`;
        button.hidden = !p.visible;
        const back = isBackFacing(node, projection.eye);
        button.dataset.back = String(back);
        const state = health.get(id) ?? "unknown";
        const halo = pixelRadius(
          projection,
          node.position,
          (node.size + 0.035) * HALO_SCALE[state] * 1.25,
        );
        const hub = node.ring === "hub";
        const gap = Math.max(hub ? 22 : 14, halo + 6);
        button.style.setProperty(
          "--stack-map-3d-label-gap",
          `${gap.toFixed(1)}px`,
        );
        const half = Math.max(hub ? 13 : 8, halo);
        nodeRects.set(id, {
          x: p.x - half,
          y: p.y - half,
          w: half * 2,
          h: half * 2,
        });
        let size = labelSizes.current.get(id);
        if (!size) {
          const label = button.querySelector<HTMLElement>(
            ".stack-map__node-label",
          );
          size = { w: label?.offsetWidth ?? 60, h: label?.offsetHeight ?? 14 };
          if (size.w > 0) labelSizes.current.set(id, size);
        }
        const center = domeScreens.get(node.domeId);
        candidates.push({
          id,
          x: p.x,
          y: p.y,
          depth: p.depth,
          width: size.w + 4,
          height: size.h,
          gap,
          preferred:
            hub || !center
              ? "below"
              : preferredSide(p.x - center.x, p.y - center.y),
          priority:
            id === current.selectedId
              ? 0
              : id === current.hoveredId
                ? 1
                : hub
                  ? 2
                  : current.previewing && current.activeIds.has(id)
                    ? 3
                    : back
                      ? 5
                      : 4,
        });
        depths.push({ id, depth: p.depth });
      }
      depths
        .sort((a, b) => b.depth - a.depth)
        .forEach(({ id }, index) => {
          const button = nodeRefs.current.get(id);
          if (button) button.style.zIndex = String(2 + index);
        });
      const obstacles: Rect[] = [];
      for (const node of scene.nodes.values()) {
        const tip = gaugeTip(node);
        if (!tip) continue;
        const a = project(projection, node.position);
        const b = project(projection, tip);
        obstacles.push({
          x: Math.min(a.x, b.x) - 3,
          y: Math.min(a.y, b.y) - 3,
          w: Math.abs(a.x - b.x) + 6,
          h: Math.abs(a.y - b.y) + 6,
        });
      }
      for (const [id, placement] of placeLabels(
        candidates,
        nodeRects,
        obstacles,
      )) {
        const button = nodeRefs.current.get(id);
        if (!button) continue;
        button.dataset.label = placement.side;
        button.dataset.labelHidden = String(placement.hidden);
      }
      for (const dome of scene.domes) {
        const caption = captionRefs.current.get(dome.id);
        if (!caption) continue;
        const p = project(projection, [
          dome.center[0],
          0,
          dome.center[2] + dome.radius + 0.5,
        ]);
        caption.style.left = `${p.x.toFixed(1)}px`;
        caption.style.top = `${p.y.toFixed(1)}px`;
      }
      const tooltip = tooltipRef.current;
      const hovered = current.hoveredId
        ? scene.nodes.get(current.hoveredId)
        : undefined;
      if (tooltip && hovered) {
        const p = project(projection, hovered.position);
        tooltip.style.left = `${p.x.toFixed(1)}px`;
        tooltip.style.top = `${p.y.toFixed(1)}px`;
        tooltip.dataset.flip = String(p.y < 150);
      }
    };

    const draw = () => {
      frame = 0;
      const controller = controllerRef.current;
      const renderer = rendererRef.current;
      const current = highlightRef.current;
      if (!controller || !renderer || !current) return;
      const state = controller.get();
      const projection = projectionFor(
        state,
        stage.clientWidth,
        stage.clientHeight,
      );
      const visible: VisibleDot[] = [];
      let pulsing = false;
      const run = pulseRunRef.current;
      if (run) {
        const elapsed = performance.now() - run.start;
        for (const dot of run.dots) {
          const next = dotState(dot, elapsed);
          if (next.running) pulsing = true;
          if (next.visible)
            visible.push({
              position: next.position,
              opacity: next.opacity,
              error: dot.error,
              edge: dot.edge,
              travelled: next.travelled,
              reverse: dot.reverse,
              beam: dot.beam,
            });
        }
        if (!pulsing) pulseRunRef.current = null;
      }
      renderer.render({
        projection,
        camera: state,
        highlight: current,
        dots: visible,
        levels: levelsRef.current,
        levelsPaused: pausedRef.current,
      });
      layoutOverlay(projection);
      stage.dataset.pulses = String(visible.length);
      stage.dataset.camera = [state.azimuth, state.polar, state.distance]
        .map((value) => value.toFixed(2))
        .join(",");
      stage.dataset.animating = String(controller.isAnimating());
      if (pulsing) request();
    };
    const request = () => {
      if (!frame && !disposed) frame = window.requestAnimationFrame(draw);
    };
    requestRef.current = request;

    const firstLoad = !cameraRef.current;
    const controller = createOrbitController({
      element: stage,
      scene,
      initial:
        cameraRef.current ??
        (motionAllowed
          ? topDownCamera(scene, aspect())
          : defaultCamera(scene, aspect())),
      aspect,
      onChange: (state) => {
        cameraRef.current = state;
        request();
      },
    });
    controllerRef.current = controller;
    const resize = new ResizeObserver(() => request());
    resize.observe(stage);

    try {
      rendererRef.current = createThreeRenderer(layer, scene, {
        health,
        tokens,
        onContextLost: () => unavailableRef.current("context-lost"),
        onQuality: setQuality,
      });
      setRendererState("ready");
      request();
      if (firstLoad && motionAllowed)
        controller.set(
          defaultCamera(scene, aspect()),
          tokens.durations.intro,
          0.08,
        );
      cameraRef.current = controller.get();
    } catch {
      unavailableRef.current("failed");
    }

    return () => {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      resize.disconnect();
      controller.dispose();
      rendererRef.current?.dispose();
      rendererRef.current = null;
      controllerRef.current = null;
    };
  }, [scene, health, motionAllowed, nodeRefs]);

  useEffect(() => {
    if (!motionAllowed || activityView.sequence === null) return;
    const rates = new Map(
      scene.beams.map((beam) => [
        beam.serviceId,
        rate(
          activityView.readings
            .get(beam.serviceId)
            ?.find((reading) => reading.label === "Ingress")?.value,
        ),
      ]),
    );
    const dots = [
      ...schedulePulses(scene, activityView.pulses),
      ...scheduleBeams(scene, rates),
    ];
    if (!dots.length) return;
    pulseRunRef.current = { start: performance.now(), dots };
    requestRef.current();
  }, [activityView.sequence, motionAllowed, scene]);

  const stageAspect = () => {
    const stage = stageRef.current;
    return stage ? stage.clientWidth / Math.max(1, stage.clientHeight) : 1.8;
  };
  const duration = (key: keyof StackMap3DTokens["durations"]) =>
    motionAllowed ? (tokensRef.current?.durations[key] ?? 0) : 0;

  function flyTo(id: string) {
    const controller = controllerRef.current;
    const node = scene.nodes.get(id);
    if (!controller || !node) return;
    const state = controller.get();
    controller.set(
      {
        ...state,
        azimuth: state.azimuth + (motionAllowed ? 0.18 : 0),
        target: [node.position[0], node.position[1] * 0.5, node.position[2]],
        distance: Math.min(
          state.distance,
          fitDistance(scene, stageAspect()) * 0.68,
        ),
      },
      duration("fly"),
      motionAllowed ? 0.12 : 0,
    );
  }

  function faceNode(id: string) {
    const controller = controllerRef.current;
    const node = scene.nodes.get(id);
    const dome = scene.domes.find((item) => item.id === node?.domeId);
    if (!controller || !node || !dome) return;
    const state = controller.get();
    const { eye } = projectionFor(state, 1, 1);
    if (!isBackFacing(node, eye)) return;
    controller.set(
      {
        ...state,
        azimuth: Math.atan2(
          node.position[0] - dome.center[0],
          node.position[2] - dome.center[2],
        ),
      },
      duration("fly"),
    );
  }

  function select(id: string) {
    onSelect(id);
    setHoveredId(null);
    flyTo(id);
  }

  function resetView() {
    setHoveredId(null);
    controllerRef.current?.set(
      defaultCamera(scene, stageAspect()),
      duration("reset"),
      motionAllowed ? 0.15 : 0,
    );
  }

  const observed = snapshot.availability === "available";
  const hasMetrics = observed && snapshot.metricsSource !== null;
  const tooltipService = previewId ? servicesById.get(previewId) : undefined;
  const tooltipHealth = tooltipService
    ? serviceHealth(snapshot, tooltipService)
    : "unknown";
  const tooltipReadings = tooltipService
    ? (activityView.readings.get(tooltipService.id) ?? [])
    : [];

  return (
    <div
      className="stack-map-3d"
      data-motion={motionAllowed ? "on" : "off"}
      data-renderer-state={rendererState}
      data-quality={quality}
    >
      <div
        ref={stageRef}
        className="stack-map-3d__stage"
        tabIndex={0}
        aria-label="3D map. Shift and arrow keys orbit, plus and minus zoom, 0 resets the view."
        onKeyDown={(event) => {
          const controller = controllerRef.current;
          if (!controller) return;
          if (event.shiftKey && event.key.startsWith("Arrow")) {
            event.preventDefault();
            const step = 0.12;
            if (event.key === "ArrowLeft") controller.orbit(step, 0);
            if (event.key === "ArrowRight") controller.orbit(-step, 0);
            if (event.key === "ArrowUp") controller.orbit(0, -step);
            if (event.key === "ArrowDown") controller.orbit(0, step);
          } else if (event.key === "+" || event.key === "=") {
            event.preventDefault();
            controller.zoom(0.88);
          } else if (event.key === "-") {
            event.preventDefault();
            controller.zoom(1.14);
          } else if (event.key === "0") {
            event.preventDefault();
            resetView();
          }
        }}
      >
        <div ref={layerRef} className="stack-map-3d__layer" />
        {scene.domes.map((dome) => (
          <div
            key={dome.id}
            ref={(node) => {
              if (node) captionRefs.current.set(dome.id, node);
              else captionRefs.current.delete(dome.id);
            }}
            className="stack-map-3d__caption"
            data-kind={dome.kind}
          >
            {dome.name}
          </div>
        ))}
        {[...scene.nodes.values()].map((node) => {
          const service = node.service;
          const state = health.get(service.id) ?? "unknown";
          const runtime = observed ? service.runtimeState : "unknown";
          const active = related.activeIds.has(service.id);
          const word = !observed
            ? null
            : state === "unhealthy"
              ? "failing"
              : runtime !== "running"
                ? runtime
                : null;
          const dome = scene.domes.find((item) => item.id === node.domeId);
          return (
            <button
              key={service.id}
              ref={(element) => {
                if (element) nodeRefs.current.set(service.id, element);
                else nodeRefs.current.delete(service.id);
              }}
              type="button"
              className="stack-map__node stack-map-3d__node"
              aria-label={`Inspect ${service.label}`}
              aria-pressed={selectedId === service.id}
              data-active={active}
              data-dimmed={Boolean(previewId) && !active}
              data-selected={selectedId === service.id}
              data-health={state}
              data-runtime={runtime}
              data-hub={node.ring === "hub"}
              data-ring={node.ring}
              onPointerEnter={() => {
                if (!controllerRef.current?.isAnimating())
                  setHoveredId(service.id);
              }}
              onPointerLeave={() => setHoveredId(null)}
              onFocus={(event) => {
                if (!event.currentTarget.matches(":focus-visible")) return;
                setFocusedId(service.id);
                faceNode(service.id);
              }}
              onBlur={() => setFocusedId(null)}
              onClick={() => select(service.id)}
              onKeyDown={(event) => {
                if (event.shiftKey || !event.key.startsWith("Arrow")) return;
                event.preventDefault();
                event.stopPropagation();
                const order = dome?.order ?? [];
                const index = order.indexOf(service.id);
                const offset =
                  event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
                const next =
                  order[(index + offset + order.length) % order.length];
                if (next)
                  nodeRefs.current.get(next)?.focus({ preventScroll: true });
              }}
            >
              <span className="stack-map__node-ring" aria-hidden="true" />
              <span className="stack-map__node-core" aria-hidden="true" />
              <span className="stack-map__node-label">
                {service.label}
                {word ? (
                  <span className="stack-map__node-state">{word}</span>
                ) : null}
              </span>
            </button>
          );
        })}
        <div
          ref={tooltipRef}
          className="stack-map-3d__tooltip"
          aria-hidden="true"
          hidden={!tooltipService}
        >
          {tooltipService ? (
            <>
              <strong>{tooltipService.label}</strong>
              <span data-health={tooltipHealth}>
                {observed ? tooltipService.runtimeState : "State unknown"} ·{" "}
                {tooltipHealth === "healthy"
                  ? "passing"
                  : tooltipHealth === "unhealthy"
                    ? "failing"
                    : "health unknown"}
              </span>
              <span>
                CPU{" "}
                {numeric(hasMetrics ? tooltipService.cpuPercent : null, "%", 1)}{" "}
                · Memory{" "}
                {numeric(hasMetrics ? tooltipService.memoryMiB : null, " MiB")}
              </span>
              {tooltipReadings.slice(0, 2).map((reading, index) => (
                <span key={`${reading.label}-${index}`}>
                  {reading.label} {reading.value}
                </span>
              ))}
            </>
          ) : null}
        </div>
        <button
          type="button"
          className="stack-map-3d__reset"
          onClick={resetView}
        >
          Reset view
        </button>
      </div>
      <p className="stack-map-3d__hint">
        Node size is memory, the spike is CPU and a dashed halo means health is
        unknown. Drag to orbit, Shift or right drag to pan, wheel to zoom.
        {quality === "reduced"
          ? " Software rendering: bloom is off and resting links are thinner."
          : ""}
      </p>
    </div>
  );
}
