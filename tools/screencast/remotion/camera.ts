import { spring } from "remotion";
import type { CaptureEvent } from "../events";

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface CameraOptions {
  viewport: { width: number; height: number };
  fps: number;
  zoom?: number;
  lead?: number;
  hold?: number;
  move?: number;
}

type Click = Extract<CaptureEvent, { type: "click" }>;
type Settings = Required<CameraOptions>;

const DEFAULTS = { zoom: 1.6, lead: 0.5, hold: 1.4, move: 0.7 };

function progress(settings: Settings, seconds: number): number {
  if (seconds <= 0) return 0;
  return spring({
    frame: seconds * settings.fps,
    fps: settings.fps,
    config: { damping: 200 },
    durationInFrames: Math.round(settings.move * settings.fps),
  });
}

function mix(from: Camera, to: Camera, amount: number): Camera {
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
    zoom: from.zoom + (to.zoom - from.zoom) * amount,
  };
}

function clamp(
  camera: Camera,
  { width, height }: Settings["viewport"],
): Camera {
  const halfWidth = width / (2 * camera.zoom);
  const halfHeight = height / (2 * camera.zoom);
  return {
    x: Math.min(Math.max(camera.x, halfWidth), width - halfWidth),
    y: Math.min(Math.max(camera.y, halfHeight), height - halfHeight),
    zoom: camera.zoom,
  };
}

function follow(
  clicks: Click[],
  time: number,
  settings: Settings,
  rest: Camera,
): Camera {
  let index = clicks.length - 1;
  while (index >= 0 && clicks[index].t - settings.lead > time) index--;
  if (index < 0) return rest;

  const click = clicks[index];
  const start = click.t - settings.lead;
  const from = follow(clicks.slice(0, index), start, settings, rest);
  const target = clamp(
    { x: click.x, y: click.y, zoom: settings.zoom },
    settings.viewport,
  );
  const releaseAt = click.t + settings.hold;
  if (time <= releaseAt)
    return mix(from, target, progress(settings, time - start));

  const held = mix(from, target, progress(settings, releaseAt - start));
  return mix(held, rest, progress(settings, time - releaseAt));
}

export function cameraAt(
  events: CaptureEvent[],
  time: number,
  options: CameraOptions,
): Camera {
  const settings: Settings = { ...DEFAULTS, ...options };
  const rest = {
    x: settings.viewport.width / 2,
    y: settings.viewport.height / 2,
    zoom: 1,
  };
  const clicks = events
    .filter((event): event is Click => event.type === "click")
    .sort((a, b) => a.t - b.t);
  return clamp(follow(clicks, time, settings, rest), settings.viewport);
}
