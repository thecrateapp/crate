// TEST_GAP: ScrollTrigger and SVG geometry (getPointAtLength) need a real layout engine; the step and segment maths is covered in lib/system-map.test.ts and the sequence is checked with Playwright.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { edges } from "../../content/architecture/map";
import { routeEdges, segmentProgress, stepAt } from "../../lib/system-map";
import { reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";

gsap.registerPlugin(ScrollTrigger);

const DRAW_SHARE = 0.7;

export function initTrace(): Cleanup {
  const root = document.querySelector<HTMLElement>("[data-trace]");
  if (!root) return () => {};
  const steps = [...root.querySelectorAll<HTMLElement>(".trace-step")];
  const traceEdges = edges.filter((edge) => !edge.only);
  const routes = steps.map((step) => {
    const stops = (step.dataset.route ?? "").split(" ");
    return { stops, edges: routeEdges(stops, traceEdges) };
  });
  const nodeEls = [...root.querySelectorAll<SVGGElement>("[data-node]")];
  const edgePaths = new Map<string, SVGPathElement[]>();
  root.querySelectorAll<SVGPathElement>(".edge-hl").forEach((path) => {
    const id = path.dataset.edge ?? "";
    edgePaths.set(id, [...(edgePaths.get(id) ?? []), path]);
  });
  const drawnState = new Map<string, string>();
  const svgs = [...root.querySelectorAll<SVGSVGElement>("svg.map")];

  function drawEdge(
    id: string,
    amount: number,
    reversed: boolean,
    past: boolean,
  ) {
    const offset = String(reversed ? -(1 - amount) : 1 - amount);
    const state = `${offset}|${past}`;
    if (drawnState.get(id) === state) return;
    drawnState.set(id, state);
    edgePaths.get(id)?.forEach((path) => {
      path.style.strokeDashoffset = offset;
      path.classList.toggle("is-past", past);
    });
  }

  function markNodes(on: Set<string>, past: Set<string>) {
    nodeEls.forEach((node) => {
      const id = node.dataset.node ?? "";
      node.classList.toggle("is-on", on.has(id));
      node.classList.toggle("is-past", !on.has(id) && past.has(id));
    });
  }

  function reset() {
    root!.classList.remove("is-live");
    steps.forEach((step) => step.classList.remove("is-active"));
    markNodes(new Set(), new Set());
    drawnState.clear();
    edgePaths.forEach((paths) =>
      paths.forEach((path) => {
        path.style.strokeDashoffset = "";
        path.classList.remove("is-past");
      }),
    );
    root!
      .querySelectorAll<SVGCircleElement>(".trace-dot")
      .forEach((dot) => (dot.style.opacity = ""));
  }

  if (reducedMotion()) {
    const all = new Set(routes.flatMap((route) => route.stops));
    markNodes(new Set(), all);
    routes.forEach((route) =>
      route.edges.forEach((edge) => drawEdge(edge.id, 1, edge.reversed, true)),
    );
    return reset;
  }

  root.classList.add("is-live");
  let active = -1;
  let svg: SVGSVGElement | undefined;
  let dot: SVGCircleElement | null = null;

  function pickSvg() {
    svg = svgs.find((candidate) => candidate.getBoundingClientRect().width > 0);
    dot = svg?.querySelector<SVGCircleElement>(".trace-dot") ?? null;
  }

  function settleRoutes(index: number) {
    routes.forEach((route, i) => {
      if (i > index)
        route.edges.forEach((edge) =>
          drawEdge(edge.id, 0, edge.reversed, false),
        );
    });
    routes.forEach((route, i) => {
      if (i < index)
        route.edges.forEach((edge) =>
          drawEdge(edge.id, 1, edge.reversed, true),
        );
    });
  }

  function render(progress: number) {
    const { index, local } = stepAt(progress, steps.length);
    const drawn = Math.min(1, local / DRAW_SHARE);
    if (index !== active) {
      active = index;
      steps.forEach((step, i) =>
        step.classList.toggle("is-active", i === index),
      );
      markNodes(
        new Set(routes[index].stops),
        new Set(routes.slice(0, index).flatMap((route) => route.stops)),
      );
      settleRoutes(index);
    }
    const current = routes[index].edges;
    current.forEach((edge, i) =>
      drawEdge(
        edge.id,
        segmentProgress(drawn, current.length, i),
        edge.reversed,
        false,
      ),
    );

    if (!svg || !dot) return;
    const segment = Math.min(
      current.length - 1,
      Math.floor(drawn * current.length),
    );
    const edge = current[segment];
    const path = edgePaths
      .get(edge.id)
      ?.find((candidate) => candidate.ownerSVGElement === svg);
    if (!path) return;
    const t = segmentProgress(drawn, current.length, segment);
    const point = path.getPointAtLength(
      (edge.reversed ? 1 - t : t) * path.getTotalLength(),
    );
    dot.setAttribute("cx", String(point.x));
    dot.setAttribute("cy", String(point.y));
    dot.style.opacity = drawn >= 1 ? "0" : "1";
  }

  pickSvg();
  const trigger = ScrollTrigger.create({
    trigger: root,
    start: "top top",
    end: "bottom bottom",
    onUpdate: ({ progress }) => render(progress),
    onRefresh: ({ progress }) => {
      pickSvg();
      render(progress);
    },
  });
  render(trigger.progress);

  return () => {
    trigger.kill();
    reset();
  };
}
