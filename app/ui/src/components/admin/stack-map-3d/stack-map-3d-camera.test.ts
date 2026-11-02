import { describe, expect, it, vi } from "vitest";
import {
  clampCamera,
  createOrbitController,
  defaultCamera,
  fitDistance,
  interpolateCamera,
  project,
  projectionFor,
  topDownCamera,
} from "./stack-map-3d-camera";
import { buildScene3D, MAX_POLAR } from "./stack-map-3d-model";
import { snapshot } from "./stack-map-3d.fixture";

const scene = buildScene3D(snapshot());
const ASPECT = 1.6;

describe("camera limits", () => {
  it("never tilts below the horizon limit or above the zenith", () => {
    const base = defaultCamera(scene, ASPECT);
    expect(clampCamera({ ...base, polar: 3 }, scene, ASPECT).polar).toBe(
      MAX_POLAR,
    );
    expect(clampCamera({ ...base, polar: -1 }, scene, ASPECT).polar).toBe(0);
  });

  it("bounds zoom to the fitted distance and pan to the domes", () => {
    const base = defaultCamera(scene, ASPECT);
    const fit = fitDistance(scene, ASPECT);
    expect(clampCamera({ ...base, distance: 0 }, scene, ASPECT).distance).toBe(
      fit * 0.32,
    );
    expect(
      clampCamera({ ...base, distance: 1000 }, scene, ASPECT).distance,
    ).toBe(fit * 1.8);
    const panned = clampCamera(
      { ...base, target: [100, -5, -100] },
      scene,
      ASPECT,
    );
    expect(panned.target).toEqual([
      scene.bounds.max[0],
      0,
      scene.bounds.min[2],
    ]);
  });

  it("starts top-down for the intro and frames the target at the centre", () => {
    const intro = topDownCamera(scene, ASPECT);
    expect(intro.polar).toBe(0);
    expect(intro.distance).toBeGreaterThan(
      defaultCamera(scene, ASPECT).distance,
    );
    const projection = projectionFor(defaultCamera(scene, ASPECT), 800, 500);
    const centre = project(projection, defaultCamera(scene, ASPECT).target);
    expect(centre.x).toBeCloseTo(400, 3);
    expect(centre.y).toBeCloseTo(250, 3);
    expect(centre.visible).toBe(true);
  });

  it("interpolates along the shorter azimuth and lands on the target", () => {
    const from = { ...defaultCamera(scene, ASPECT), azimuth: 3 };
    const to = { ...from, azimuth: -3 };
    const middle = interpolateCamera(from, to, 0.5);
    expect(Math.abs(middle.azimuth)).toBeGreaterThan(3);
    expect(interpolateCamera(from, to, 1).azimuth).toBeCloseTo(
      3 + (2 * Math.PI - 6),
      6,
    );
    expect(interpolateCamera(from, to, 0).distance).toBe(from.distance);
  });
});

describe("orbit controller", () => {
  it("orbits, zooms and jumps instantly inside the limits", () => {
    const element = document.createElement("div");
    const onChange = vi.fn();
    const controller = createOrbitController({
      element,
      scene,
      initial: defaultCamera(scene, ASPECT),
      aspect: () => ASPECT,
      onChange,
    });
    const start = controller.get();
    controller.orbit(0.5, 10);
    expect(controller.get().azimuth).toBeCloseTo(start.azimuth + 0.5, 6);
    expect(controller.get().polar).toBe(MAX_POLAR);
    controller.zoom(0.0001);
    expect(controller.get().distance).toBeCloseTo(
      fitDistance(scene, ASPECT) * 0.32,
      6,
    );
    controller.set(defaultCamera(scene, ASPECT));
    expect(controller.isAnimating()).toBe(false);
    expect(controller.get()).toEqual(
      clampCamera(defaultCamera(scene, ASPECT), scene, ASPECT),
    );
    expect(onChange).toHaveBeenCalledTimes(3);
    controller.dispose();
  });
});
