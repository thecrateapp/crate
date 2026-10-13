import {
  cloudPositions,
  clusterCenters,
  loadLibraryCloud,
  mulberry32,
} from "../field/sources";
import { isMobile } from "../motion/env";
import type { Cleanup } from "../motion/page";
import { mountDive, type SceneFactory } from "./dive";
import { createPathsScene } from "./paths";
import { createRadioScene } from "./radio";

const scenes: Record<string, SceneFactory> = {
  radio: createRadioScene,
  paths: createPathsScene,
};

export function initListenDives(): Cleanup {
  const roots = [...document.querySelectorAll<HTMLElement>("[data-dive]")];
  if (!roots.length) return () => {};
  const count = isMobile() ? 6000 : 14000;
  const random = mulberry32(7);
  const { positions } = cloudPositions(
    count,
    clusterCenters(14, 1, random),
    random,
  );
  const dives = roots.flatMap((root) => {
    const factory = scenes[root.dataset.dive ?? ""];
    return factory ? [mountDive(root, positions, factory)] : [];
  });
  let disposed = false;
  loadLibraryCloud("/data/library-cloud.bin", count).then((real) => {
    if (real && !disposed) dives.forEach((dive) => dive.setCloud(real));
  });
  return () => {
    disposed = true;
    dives.forEach((dive) => dive.cleanup());
  };
}
