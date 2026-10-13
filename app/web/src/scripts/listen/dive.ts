// TEST_GAP: WebGL2, ScrollTrigger and IntersectionObserver wiring cannot run in jsdom; the pure scene maths is covered in scene.test.ts and the page is checked with Playwright.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { createField, type Field } from "../field/renderer";
import { isMobile, reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";

gsap.registerPlugin(ScrollTrigger);

export interface DiveScene {
  frame(phase: number, time: number): void;
  setCloud(positions: Float32Array): void;
  dispose(): void;
}

export interface DiveContext {
  root: HTMLElement;
  svg: SVGSVGElement;
  reduced: boolean;
  mobile: boolean;
}

export type SceneFactory = (
  field: Field,
  positions: Float32Array,
  context: DiveContext,
) => DiveScene;

export interface Dive {
  setCloud(positions: Float32Array): void;
  cleanup: Cleanup;
}

export function mountDive(
  root: HTMLElement,
  cloud: Float32Array,
  createScene: SceneFactory,
): Dive {
  const canvas = root.querySelector<HTMLCanvasElement>(".dive-canvas");
  const svg = root.querySelector<SVGSVGElement>(".dive-svg");
  const stepList = root.querySelector<HTMLElement>(".dive-steps");
  const steps = [...root.querySelectorAll<HTMLElement>(".dive-step")];
  const reduced = reducedMotion();
  const mobile = isMobile();
  const total = steps.length;
  const listeners = new AbortController();
  let field: Field | null = null;
  let scene: DiveScene | null = null;
  let trigger: ScrollTrigger | null = null;
  let frame = 0;
  let visible = false;
  let target = reduced ? total - 0.001 : 0;
  let phase = target;
  let active = -1;
  let positions = cloud;

  function setActive(index: number) {
    if (index === active) return;
    active = index;
    steps.forEach((step, i) => step.classList.toggle("is-active", i === index));
  }

  function start() {
    if (!canvas || !svg || field) return;
    field = createField(canvas, {
      positions,
      pointScale: 6,
      mobileScale: 4.4,
      isMobile: mobile,
    });
    if (!field) {
      root.classList.add("no-gl");
      return;
    }
    scene = createScene(field, positions, { root, svg, reduced, mobile });
    root.classList.add("has-gl");

    if (reduced) {
      steps.forEach((step) => step.classList.add("is-active"));
      scene.frame(phase, 0);
      addEventListener("resize", () => scene?.frame(phase, 0), {
        signal: listeners.signal,
      });
      return;
    }

    trigger = ScrollTrigger.create({
      trigger: stepList ?? root,
      start: "top 62%",
      end: "bottom 62%",
      onUpdate: ({ progress }) => {
        target = Math.min(total - 0.001, progress * total);
      },
    });

    const loop = (time: number) => {
      phase += (target - phase) * 0.12;
      if (Math.abs(target - phase) < 0.0005) phase = target;
      setActive(Math.floor(target));
      if (visible && !document.hidden) scene?.frame(phase, time / 1000);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
  }

  const observer = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
    },
    { rootMargin: "40% 0px" },
  );
  observer.observe(root);
  if (!reduced) setActive(0);

  return {
    setCloud(next) {
      positions = next;
      if (!field || !scene) return;
      field.setPositions(next);
      scene.setCloud(next);
      if (reduced) scene.frame(phase, 0);
    },
    cleanup() {
      observer.disconnect();
      listeners.abort();
      cancelAnimationFrame(frame);
      trigger?.kill();
      scene?.dispose();
      field?.dispose();
      field = null;
      scene = null;
      root.classList.remove("has-gl", "no-gl");
      steps.forEach((step) => step.classList.remove("is-active"));
    },
  };
}

export function svgElement<K extends keyof SVGElementTagNameMap>(
  parent: SVGElement,
  name: K,
  attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes))
    element.setAttribute(key, String(value));
  parent.appendChild(element);
  return element;
}
