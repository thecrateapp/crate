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
  const edgeEls = (id: string) =>
    root.querySelectorAll<SVGPathElement>(`.edge-hl[data-edge="${id}"]`);
  const svgs = [...root.querySelectorAll<SVGSVGElement>("svg.map")];

  function drawEdge(
    id: string,
    amount: number,
    reversed: boolean,
    past: boolean,
  ) {
    const offset = reversed ? -(1 - amount) : 1 - amount;
    edgeEls(id).forEach((path) => {
      path.style.strokeDashoffset = String(offset);
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
    root!.querySelectorAll<SVGPathElement>(".edge-hl").forEach((path) => {
      path.style.strokeDashoffset = "";
      path.classList.remove("is-past");
    });
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
    }
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
    const current = routes[index].edges;
    current.forEach((edge, i) =>
      drawEdge(
        edge.id,
        segmentProgress(drawn, current.length, i),
        edge.reversed,
        false,
      ),
    );

    const svg = svgs.find(
      (candidate) => candidate.getBoundingClientRect().width > 0,
    );
    const dot = svg?.querySelector<SVGCircleElement>(".trace-dot");
    if (!svg || !dot) return;
    const segment = Math.min(
      current.length - 1,
      Math.floor(drawn * current.length),
    );
    const edge = current[segment];
    const path = svg.querySelector<SVGPathElement>(
      `.edge-hl[data-edge="${edge.id}"]`,
    );
    if (!path) return;
    const t = segmentProgress(drawn, current.length, segment);
    const point = path.getPointAtLength(
      (edge.reversed ? 1 - t : t) * path.getTotalLength(),
    );
    dot.setAttribute("cx", String(point.x));
    dot.setAttribute("cy", String(point.y));
    dot.style.opacity = drawn >= 1 ? "0" : "1";
  }

  const trigger = ScrollTrigger.create({
    trigger: root,
    start: "top top",
    end: "bottom bottom",
    onUpdate: ({ progress }) => render(progress),
    onRefresh: ({ progress }) => render(progress),
  });
  render(trigger.progress);

  return () => {
    trigger.kill();
    reset();
  };
}
