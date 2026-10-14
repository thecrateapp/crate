import { MIX } from "../../content/listen/viz";
import { isMobile, reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";
import { observeSize, svg, visibleLoop } from "./loop";
import { beatTimes, equalPower, waveform } from "./mix-math";

const SWEEP = 8.5;
const HOLD = 1.6;

export function initMix(root: HTMLElement): Cleanup {
  const surface = root.querySelector<SVGSVGElement>(".mix-svg");
  const stage = root.querySelector<HTMLElement>(".mix-stage");
  if (!surface || !stage) return () => {};
  const reduced = reducedMotion();
  const gainText = {
    a: root.querySelector<HTMLElement>('[data-gain="a"]'),
    b: root.querySelector<HTMLElement>('[data-gain="b"]'),
  };
  const gainBar = {
    a: root.querySelector<HTMLElement>('[data-gain-bar="a"]'),
    b: root.querySelector<HTMLElement>('[data-gain-bar="b"]'),
  };
  const fadeLength = (MIX.fadeBars * 4 * 60) / MIX.bpm;
  const fadeStart = MIX.fadeStart;
  const fadeEnd = fadeStart + fadeLength;
  const span = MIX.windowSeconds;

  let width = 0;
  let clip: SVGRectElement | null = null;
  let head: SVGLineElement | null = null;
  let litA: SVGGElement | null = null;
  let litB: SVGGElement | null = null;
  let dotOut: SVGCircleElement | null = null;
  let dotIn: SVGCircleElement | null = null;
  let t0 = 0;
  let t1 = span;
  let toX = (t: number) => t;
  let gainToY = (g: number) => g;
  let elapsed = 0;
  let lastShown = "";

  function lane(
    parent: SVGElement,
    values: number[],
    from: number,
    pitch: number,
    top: number,
    bottom: number,
  ) {
    const mid = (top + bottom) / 2;
    const half = (bottom - top) / 2;
    const bar = Math.max(1.2, pitch - 1.6);
    let d = "";
    values.forEach((value, i) => {
      const x = from + i * pitch;
      const h = Math.max(1, value * half);
      d += `M${x.toFixed(1)} ${(mid - h).toFixed(1)}h${bar}v${(h * 2).toFixed(
        1,
      )}h-${bar}Z`;
    });
    svg(parent, "path", { d });
  }

  function build(w: number, h: number) {
    width = w;
    surface!.setAttribute("viewBox", `0 0 ${w} ${h}`);
    surface!.replaceChildren();
    const mobile = w < 640;
    const pad = 30;
    const ruler = mobile ? 26 : 34;
    const laneH = (h - pad * 2 - ruler) / 2;
    const aTop = pad;
    const aBot = aTop + laneH;
    const bTop = aBot + ruler;
    const bBot = bTop + laneH;
    t0 = mobile ? fadeStart - 3 : 0;
    t1 = mobile ? fadeEnd + 3 : span;
    toX = (t: number) => ((t - t0) / (t1 - t0)) * w;
    gainToY = (g: number) => bBot - g * (bBot - aTop);
    const pitch = mobile ? 5 : 4;

    const defs = svg(surface!, "defs");
    const clipPath = svg(defs, "clipPath", { id: "lvz-mix-clip" });
    clip = svg(clipPath, "rect", { x: 0, y: 0, width: 0, height: h });

    const zone = svg(surface!, "g", { class: "mix-zone" });
    svg(zone, "rect", {
      x: toX(fadeStart),
      y: aTop - 6,
      width: toX(fadeEnd) - toX(fadeStart),
      height: bBot - aTop + 12,
    });

    const ticks = svg(surface!, "g", { class: "mix-ticks" });
    beatTimes(MIX.bpm, span).forEach((time, i) => {
      if (time < t0 || time > t1) return;
      const x = toX(time);
      const down = i % 4 === 0;
      const size = down ? ruler * 0.42 : ruler * 0.2;
      svg(ticks, "line", {
        x1: x,
        x2: x,
        y1: aBot + ruler / 2 - size,
        y2: aBot + ruler / 2 + size,
        class: down ? "down" : "",
      });
    });

    const aCount = Math.floor(toX(fadeEnd) / pitch);
    const bFrom = toX(fadeStart);
    const bCount = Math.floor((w - bFrom) / pitch);
    const aValues = waveform({
      bars: aCount,
      seed: 4,
      rampOut: fadeStart / fadeEnd,
    });
    const bValues = waveform({ bars: bCount, seed: 9, rampIn: 0.42 });

    const base = svg(surface!, "g", { class: "mix-wave dim" });
    lane(base, aValues, 0, pitch, aTop, aBot);
    lane(base, bValues, bFrom, pitch, bTop, bBot);
    litA = svg(surface!, "g", {
      class: "mix-wave lit",
      "clip-path": "url(#lvz-mix-clip)",
    });
    lane(litA, aValues, 0, pitch, aTop, aBot);
    litB = svg(surface!, "g", {
      class: "mix-wave lit",
      "clip-path": "url(#lvz-mix-clip)",
    });
    lane(litB, bValues, bFrom, pitch, bTop, bBot);

    const curve = (fn: (t: number) => number) => {
      let d = "";
      for (let i = 0; i <= 48; i += 1) {
        const p = i / 48;
        const x = toX(fadeStart + p * fadeLength);
        d += `${i ? "L" : "M"}${x.toFixed(1)} ${gainToY(fn(p)).toFixed(1)}`;
      }
      return d;
    };
    const outD = curve((p) => equalPower(p).out);
    const inD = curve((p) => equalPower(p).in);
    const curves = svg(surface!, "g", { class: "mix-curves" });
    svg(curves, "path", { d: outD, class: "dim" });
    svg(curves, "path", { d: inD, class: "dim" });
    const litCurves = svg(surface!, "g", {
      class: "mix-curves lit",
      "clip-path": "url(#lvz-mix-clip)",
    });
    svg(litCurves, "path", { d: outD });
    svg(litCurves, "path", { d: inD });
    const crossX = toX(fadeStart + fadeLength / 2);
    const crossY = gainToY(Math.SQRT1_2);
    svg(curves, "circle", { cx: crossX, cy: crossY, r: 3, class: "cross" });
    const crossLabel = svg(curves, "text", {
      x: crossX - 10,
      y: crossY + 4,
      "text-anchor": "end",
      class: "mix-text lower",
    });
    crossLabel.textContent = "−3 dB";

    const markers = svg(surface!, "g", { class: "mix-markers" });
    for (const [time, label, y, anchor] of [
      [fadeStart, MIX.a.cue, aTop - 12, "start"],
      [fadeStart, MIX.b.cue, bBot + 20, "start"],
      [fadeEnd, `+${fadeLength.toFixed(1)} s`, aTop - 12, "end"],
    ] as const) {
      const x = toX(time);
      svg(markers, "line", { x1: x, x2: x, y1: aTop - 6, y2: bBot + 6 });
      const text = svg(markers, "text", {
        x: anchor === "start" ? x + 6 : x - 6,
        y,
        "text-anchor": anchor,
        class: "mix-text",
      });
      text.textContent =
        mobile && label.length > 14 ? label.replace(/ cue/, "") : label;
    }

    head = svg(surface!, "line", { y1: 8, y2: h - 8, class: "mix-head" });
    dotOut = svg(surface!, "circle", { r: 4, class: "mix-dot" });
    dotIn = svg(surface!, "circle", { r: 4, class: "mix-dot" });
    render(reduced ? fadeStart + fadeLength / 2 : simTime());
  }

  function simTime() {
    return t0 + Math.min(1, elapsed / SWEEP) * (t1 - t0);
  }

  function render(time: number) {
    if (!width || !head || !clip) return;
    const x = toX(time);
    clip.setAttribute("width", x.toFixed(1));
    head.setAttribute("x1", x.toFixed(1));
    head.setAttribute("x2", x.toFixed(1));
    const p = (time - fadeStart) / fadeLength;
    const { out, in: incoming } = equalPower(p);
    const a = time >= fadeEnd ? 0 : out;
    const b = time <= fadeStart ? 0 : incoming;
    litA!.style.opacity = (0.2 + 0.8 * a).toFixed(3);
    litB!.style.opacity = (0.2 + 0.8 * b).toFixed(3);
    const inFade = p > 0 && p < 1;
    dotOut!.style.opacity = inFade ? "1" : "0";
    dotIn!.style.opacity = inFade ? "1" : "0";
    dotOut!.setAttribute("cx", x.toFixed(1));
    dotOut!.setAttribute("cy", gainToY(out).toFixed(1));
    dotIn!.setAttribute("cx", x.toFixed(1));
    dotIn!.setAttribute("cy", gainToY(incoming).toFixed(1));
    gainBar.a?.style.setProperty("transform", `scaleX(${a.toFixed(3)})`);
    gainBar.b?.style.setProperty("transform", `scaleX(${b.toFixed(3)})`);
    const shown = `${a.toFixed(2)}|${b.toFixed(2)}`;
    if (shown !== lastShown) {
      lastShown = shown;
      if (gainText.a) gainText.a.textContent = a.toFixed(2);
      if (gainText.b) gainText.b.textContent = b.toFixed(2);
    }
  }

  const stopResize = observeSize(surface, (w, h) => build(w, h));
  if (reduced) return stopResize;

  const loop = visibleLoop(
    root,
    (_, dt) => {
      elapsed += dt;
      if (elapsed > SWEEP + HOLD) elapsed = 0;
      render(simTime());
    },
    {
      margin: isMobile() ? "0px" : "5% 0px",
      onFirstVisible: () => (elapsed = 0),
    },
  );

  return () => {
    stopResize();
    loop.cleanup();
  };
}
