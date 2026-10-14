// TEST_GAP: IntersectionObserver and dynamic chunk loading do not run in jsdom; mounting is covered by the Playwright viz specs.
import type { Cleanup } from "../motion/page";

type View = (root: HTMLElement) => Cleanup;

const views: Record<string, () => Promise<View>> = {
  eq: () => import("./eq-view").then((module) => module.initEq),
  mix: () => import("./mix-view").then((module) => module.initMix),
  moods: () => import("./mood-view").then((module) => module.initMoods),
  heatmap: () => import("./heatmap-view").then((module) => module.initHeatmap),
  federation: () =>
    import("./federation-view").then((module) => module.initFederation),
  health: () => import("./health-view").then((module) => module.initHealth),
  sidecar: () => import("./sidecar-view").then((module) => module.initSidecar),
  release: () => import("./release-view").then((module) => module.initRelease),
  enrichment: () =>
    import("./enrichment-view").then((module) => module.initEnrichment),
  genres: () => import("./genre-view").then((module) => module.initGenres),
  analysis: () =>
    import("./analysis-view").then((module) => module.initAnalysis),
  queues: () => import("./queue-view").then((module) => module.initQueues),
  governor: () =>
    import("./governor-view").then((module) => module.initGovernor),
};

export function initViz(root: ParentNode = document): Cleanup {
  let disposed = false;
  const cleanups: Cleanup[] = [];

  const mount = (element: HTMLElement) => {
    const load = views[element.dataset.viz ?? ""];
    if (!load) return;
    load().then((init) => {
      if (disposed) return;
      element.dataset.vizReady = "";
      cleanups.push(init(element));
    });
  };

  const loader = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        loader.unobserve(entry.target);
        mount(entry.target as HTMLElement);
      }
    },
    { rootMargin: "60% 0px" },
  );
  root
    .querySelectorAll<HTMLElement>("[data-viz]")
    .forEach((element) => loader.observe(element));

  const visibility = new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) =>
        entry.target.classList.toggle("is-playing", entry.isIntersecting),
      ),
    { rootMargin: "5% 0px" },
  );
  root
    .querySelectorAll("[data-playing]")
    .forEach((element) => visibility.observe(element));

  return () => {
    disposed = true;
    loader.disconnect();
    visibility.disconnect();
    cleanups.forEach((cleanup) => cleanup());
  };
}
