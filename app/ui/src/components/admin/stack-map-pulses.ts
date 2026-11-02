import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { StackActivityPulse } from "./stack-map-activity";
import type { StackMapConnection } from "./stack-map-model";

const SVG_NS = "http://www.w3.org/2000/svg";
const DURATION_MS = 1200;
const DOT_STAGGER_MS = 240;
const EDGE_STAGGER_MS = 90;

interface Dot {
  circle: SVGCircleElement;
  path: SVGPathElement;
  length: number;
  reverse: boolean;
  delay: number;
}

const ease = (value: number) => value * value * (3 - 2 * value);

export function useActivityPulses({
  layerRef,
  pathRefs,
  pulses,
  sequence,
  enabled,
}: {
  layerRef: RefObject<SVGGElement | null>;
  pathRefs: RefObject<Map<StackMapConnection, SVGPathElement>>;
  pulses: StackActivityPulse[];
  sequence: number | null;
  enabled: boolean;
}) {
  const pulsesRef = useRef(pulses);
  useLayoutEffect(() => {
    pulsesRef.current = pulses;
  }, [pulses]);

  useEffect(() => {
    const layer = layerRef.current;
    const current = pulsesRef.current;
    if (
      !enabled ||
      sequence === null ||
      !layer ||
      !current.length ||
      typeof window.requestAnimationFrame !== "function"
    )
      return;
    const dots: Dot[] = [];
    current.forEach((pulse, edgeIndex) => {
      const path = pathRefs.current?.get(pulse.connection);
      if (!path || typeof path.getTotalLength !== "function") return;
      const length = path.getTotalLength();
      const errorDots = pulse.errors
        ? Math.max(1, Math.round((pulse.errors / pulse.count) * pulse.dots))
        : 0;
      for (let index = 0; index < pulse.dots; index++) {
        const circle = document.createElementNS(SVG_NS, "circle");
        circle.setAttribute("r", "3");
        circle.setAttribute("class", "stack-map__pulse");
        if (index < errorDots) circle.dataset.error = "true";
        circle.style.opacity = "0";
        layer.appendChild(circle);
        dots.push({
          circle,
          path,
          length,
          reverse: pulse.reverse,
          delay: index * DOT_STAGGER_MS + (edgeIndex % 6) * EDGE_STAGGER_MS,
        });
      }
    });
    if (!dots.length) return;
    let frame = 0;
    const start = performance.now();
    const tick = (time: number) => {
      let running = false;
      for (const dot of dots) {
        const progress = (time - start - dot.delay) / DURATION_MS;
        if (progress < 0) {
          running = true;
          continue;
        }
        if (progress >= 1) {
          dot.circle.style.opacity = "0";
          continue;
        }
        running = true;
        const travelled = ease(dot.reverse ? 1 - progress : progress);
        const point = dot.path.getPointAtLength(travelled * dot.length);
        dot.circle.setAttribute("cx", point.x.toFixed(1));
        dot.circle.setAttribute("cy", point.y.toFixed(1));
        dot.circle.style.opacity = String(
          Math.min(1, progress * 6, (1 - progress) * 6),
        );
      }
      if (running) frame = window.requestAnimationFrame(tick);
      else for (const dot of dots) dot.circle.remove();
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      for (const dot of dots) dot.circle.remove();
    };
  }, [enabled, layerRef, pathRefs, sequence]);
}
