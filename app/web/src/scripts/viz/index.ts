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
  terminal: () =>
    import("./terminal-view").then((module) => module.initTerminal),
  allowlist: () =>
    import("./allowlist-view").then((module) => module.initAllowlist),
  inside: () => import("./inside-view").then((module) => module.initInside),
  "inside-mix": () =>
    import("./inside-mix-view").then((module) => module.initInsideMix),
  "inside-agent": () =>
    import("./inside-agent-view").then((module) => module.initInsideAgent),
  redis: () => import("./redis-view").then((module) => module.initRedis),
  steps: () => import("./steps-view").then((module) => module.initSteps),
  governor: () =>
    import("./governor-view").then((module) => module.initGovernor),
  approval: () =>
    import("./approval-view").then((module) => module.initApproval),
  agent: () => import("./agent-view").then((module) => module.initAgent),
  "stack-map": () =>
    import("./stack-map-view").then((module) => module.initStackMap),
  "blog-connect": () =>
    import("./blog/connect-view").then((module) => module.initConnect),
  "blog-crossfade": () =>
    import("./blog/crossfade-view").then((module) => module.initCrossfade),
  "blog-workers": () =>
    import("./blog/workers-view").then((module) => module.initWorkers),
  "blog-enrichment": () =>
    import("./blog/enrichment-view").then((module) => module.initEnrichment),
  "blog-smart-mix": () =>
    import("./blog/smart-mix-view").then((module) => module.initSmartMix),
  "blog-music-paths": () =>
    import("./blog/music-paths-view").then((module) => module.initMusicPaths),
  "blog-radio": () =>
    import("./blog/radio-view").then((module) => module.initRadio),
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
