// TEST_GAP: ScrollTrigger, ResizeObserver and SVG layout need a real browser; the transition maths is covered in mix-math.test.ts and the view is checked in the Playwright viz specs.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MIX } from "../../content/listen/viz";
import { reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";
import { observeSize, svg, visibleLoop } from "./loop";
import {
  equalPower,
  incomingBeats,
  incomingTempo,
  isDownbeat,
  lowsCut,
  mixSeconds,
  outgoingBeats,
  storyAt,
  storyWindow,
  swapProgress,
  waveLevels,
  type Beat,
  type MixPlan,
  type StoryFrame,
} from "./mix-math";

gsap.registerPlugin(ScrollTrigger);

const PLAN: MixPlan = {
  outgoingBpm: MIX.a.bpm,
  incomingBpm: MIX.b.bpm,
  beats: MIX.beats,
  prerollS: MIX.prerollMs / 1000,
  restoreS: MIX.tempoRestoreMs / 1000,
  swapFraction: MIX.bass.swapFraction,
  cutDb: MIX.bass.cutDb,
};
const LENGTH = mixSeconds(PLAN);
const WINDOW = storyWindow(PLAN);
const LOOSE = MIX.b.looseOffsetMs / 1000;
const TRIM = 10 ** ((MIX.a.lufs - MIX.b.lufs) / 20);
const HIT = 0.012;

interface Lane {
  top: number;
  bottom: number;
}

interface Lanes {
  aWave: Lane;
  aGrid: Lane;
  bGrid: Lane;
  bWave: Lane;
  gain: Lane;
  tempo: Lane;
  lows: Lane;
}

const minus = (value: number) => `−${Math.abs(value)}`;

export function initMix(root: HTMLElement): Cleanup {
  const surface = root.querySelector<SVGSVGElement>(".mix-svg");
  const scroller = root.querySelector<HTMLElement>(".mix-scroll");
  const pin = root.querySelector<HTMLElement>(".mix-pin");
  if (!surface || !scroller || !pin) return () => {};
  const reduced = reducedMotion();
  const out = {
    phase: root.querySelector<HTMLElement>("[data-phase]"),
    tempo: root.querySelector<HTMLElement>("[data-tempo]"),
    lows: root.querySelector<HTMLElement>("[data-lows]"),
    gainA: root.querySelector<HTMLElement>('[data-gain="a"]'),
    gainB: root.querySelector<HTMLElement>('[data-gain="b"]'),
    barA: root.querySelector<HTMLElement>('[data-gain-bar="a"]'),
    barB: root.querySelector<HTMLElement>('[data-gain-bar="b"]'),
  };
  const stages = [...root.querySelectorAll<HTMLElement>("[data-stage]")];
  const aBeats = outgoingBeats(PLAN, WINDOW.start);
  const aTimes = aBeats.map((beat) => beat.time);

  let width = 0;
  let toX = (t: number) => t;
  let pitch = 4;
  let lanes: Lanes | null = null;
  let clip: SVGRectElement | null = null;
  let head: SVGLineElement | null = null;
  let dotA: SVGCircleElement | null = null;
  let dotB: SVGCircleElement | null = null;
  let bLayer: SVGGElement | null = null;
  let builtLock = -1;
  let current = reduced ? 0.5 : 0;
  let target = current;
  let shown = "";
  let stage = -1;

  const text = (
    parent: Element,
    x: number,
    y: number,
    content: string,
    anchor = "start",
    extra = "",
  ) => {
    const node = svg(parent, "text", {
      x,
      y,
      "text-anchor": anchor,
      class: `text ${extra}`.trim(),
    });
    node.textContent = content;
    return node;
  };

  const columns = (from: number, to: number) => {
    const times: number[] = [];
    for (
      let x = Math.max(0, toX(from));
      x < Math.min(width, toX(to));
      x += pitch
    )
      times.push(WINDOW.start + (x / width) * (WINDOW.end - WINDOW.start));
    return times;
  };

  function bars(
    parent: SVGElement,
    times: number[],
    levels: number[],
    lane: Lane,
    className: string,
  ) {
    const mid = (lane.top + lane.bottom) / 2;
    const half = (lane.bottom - lane.top) / 2;
    const bar = Math.max(1.2, pitch - 1.6);
    let d = "";
    times.forEach((time, i) => {
      const h = Math.max(0.6, levels[i]! * half);
      d += `M${toX(time).toFixed(1)} ${(mid - h).toFixed(1)}h${bar}v${(
        h * 2
      ).toFixed(1)}h-${bar}Z`;
    });
    svg(parent, "path", { d, class: className });
  }

  function ticks(
    parent: SVGElement,
    beats: Beat[],
    lane: Lane,
    className: string,
    against?: number[],
  ) {
    beats.forEach(({ time, beat }) => {
      if (time < WINDOW.start || time > WINDOW.end) return;
      const x = toX(time);
      const down = isDownbeat(beat);
      const hit = against?.some((other) => Math.abs(other - time) < HIT);
      svg(parent, "line", {
        x1: x,
        x2: x,
        y1: down ? lane.top : lane.top + (lane.bottom - lane.top) * 0.35,
        y2: lane.bottom,
        class: `tick ${className}${down ? " down" : ""}${hit ? " hit" : ""}`,
      });
    });
  }

  function path(
    fn: (t: number) => number,
    from: number,
    to: number,
    lane: Lane,
  ) {
    const steps = Math.max(24, Math.round((toX(to) - toX(from)) / 3));
    let d = "";
    for (let i = 0; i <= steps; i += 1) {
      const t = from + ((to - from) * i) / steps;
      const y = lane.bottom - fn(t) * (lane.bottom - lane.top);
      d += `${i ? "L" : "M"}${toX(t).toFixed(1)} ${y.toFixed(1)}`;
    }
    return d;
  }

  const gainOf = (t: number) => equalPower(t / LENGTH);
  const lowsOf = (t: number) => lowsCut(PLAN, t / LENGTH);
  const tempoLow = Math.min(MIX.a.bpm, MIX.b.bpm) - 2;
  const tempoHigh = Math.max(MIX.a.bpm, MIX.b.bpm) + 2;
  const tempoOf = (t: number) =>
    (incomingTempo(PLAN, t) - tempoLow) / (tempoHigh - tempoLow);

  function buildIncoming(lock: number) {
    if (!bLayer || !lanes) return;
    builtLock = lock;
    bLayer.replaceChildren();
    const beats = incomingBeats(PLAN, lock, LOOSE, WINDOW.end);
    const times = beats.map((beat) => beat.time);
    const muted = columns(-PLAN.prerollS, 0);
    const live = columns(0, WINDOW.end);
    bars(bLayer, muted, waveLevels(muted, times, 9), lanes.bWave, "wave muted");
    const levels = waveLevels(live, times, 11).map(
      (level, i) => level * TRIM * gainOf(live[i]!).in,
    );
    bars(bLayer, live, levels, lanes.bWave, "wave dim");
    const lit = svg(bLayer, "g", { "clip-path": "url(#lvz-mix-clip)" });
    bars(lit, live, levels, lanes.bWave, "wave lit b");
    ticks(bLayer, beats, lanes.bGrid, "b", aTimes);
  }

  function build(w: number, h: number) {
    width = w;
    surface!.setAttribute("viewBox", `0 0 ${w} ${h}`);
    surface!.replaceChildren();
    const mobile = w < 640;
    pitch = mobile ? 3 : 4;
    toX = (t: number) => ((t - WINDOW.start) / (WINDOW.end - WINDOW.start)) * w;

    const label = mobile ? 15 : 17;
    const grid = mobile ? 10 : 12;
    const fixed = 24 + label * 5 + grid * 2 + 2 + 8 + 6 + 14 + 14;
    const unit = (h - fixed) / 18;
    let y = 24;
    const take = (size: number): Lane => {
      const lane = { top: y, bottom: y + size };
      y += size;
      return lane;
    };
    const gap = (size: number) => (y += size);
    gap(label);
    const aWave = take(unit * 4);
    gap(4);
    const aGrid = take(grid);
    gap(2);
    const bGrid = take(grid);
    gap(4);
    const bWave = take(unit * 4);
    gap(label + label + 6);
    const gain = take(unit * 4.4);
    gap(label + 8);
    const tempo = take(unit * 2.8);
    gap(label + 6);
    const lows = take(unit * 2.8);
    const l: Lanes = { aWave, aGrid, bGrid, bWave, gain, tempo, lows };
    lanes = l;

    const defs = svg(surface!, "defs");
    clip = svg(svg(defs, "clipPath", { id: "lvz-mix-clip" }), "rect", {
      x: 0,
      y: 0,
      width: 0,
      height: h,
    });

    const x0 = toX(0);
    const xEnd = toX(LENGTH);
    const xPre = toX(-PLAN.prerollS);
    const xHome = toX(LENGTH + PLAN.restoreS);
    const top = l.aWave.top - 4;
    const bottom = l.lows.bottom + 4;
    svg(surface!, "rect", {
      x: xPre,
      y: top,
      width: x0 - xPre,
      height: bottom - top,
      class: "zone-pre",
    });
    svg(surface!, "rect", {
      x: x0,
      y: top,
      width: xEnd - x0,
      height: bottom - top,
      class: "zone-mix",
    });

    const brackets = svg(surface!, "g");
    const restore = MIX.tempoRestoreMs / 1000;
    for (const [from, to, long, short] of [
      [xPre, x0, `pre-roll ${PLAN.prerollS} s · muted`, "pre-roll"],
      [
        x0,
        xEnd,
        `${MIX.beats} beats · ${LENGTH.toFixed(1)} s`,
        `${MIX.beats} beats`,
      ],
      [
        xEnd,
        xHome,
        `back to ${MIX.b.bpm} BPM · ${restore} s`,
        `${restore} s home`,
      ],
    ] as const) {
      svg(brackets, "path", {
        d: `M${from + 1} 20v-5H${to - 1}v5`,
        class: "bracket",
      });
      text(brackets, (from + to) / 2, 10, mobile ? short : long, "middle");
    }

    const labels = svg(surface!, "g");
    const trim = (MIX.a.lufs - MIX.b.lufs).toFixed(1);
    text(
      labels,
      0,
      l.aWave.top - 6,
      mobile
        ? `A · ${MIX.a.bpm} BPM · ${MIX.a.key}`
        : `${MIX.a.label} · ${MIX.a.bpm} BPM · ${MIX.a.key}`,
    );
    text(
      labels,
      0,
      l.bWave.bottom + label - 1,
      mobile
        ? `B · ${MIX.b.bpm} BPM · ${MIX.b.key} · ${minus(Number(trim))} dB`
        : `${MIX.b.label} · ${MIX.b.bpm} BPM · ${MIX.b.key} · trim ${minus(
            Number(trim),
          )} dB`,
      "start",
      "hi",
    );
    text(labels, 0, l.gain.top - 7, "gain · equal power");
    text(labels, 0, l.tempo.top - 7, "B tempo");
    text(
      labels,
      0,
      l.lows.top - 7,
      mobile
        ? `lows < ${MIX.bass.shelfHz} Hz`
        : `lows < ${MIX.bass.shelfHz} Hz · ${minus(MIX.bass.cutDb)} dB shelf`,
    );

    for (const lane of [l.gain, l.tempo, l.lows]) {
      svg(surface!, "line", {
        x1: 0,
        x2: w,
        y1: lane.bottom,
        y2: lane.bottom,
        class: "base",
      });
    }
    const tempoY = (bpm: number) =>
      l.tempo!.bottom -
      ((bpm - tempoLow) / (tempoHigh - tempoLow)) *
        (l.tempo!.bottom - l.tempo!.top);
    for (const bpm of [MIX.a.bpm, MIX.b.bpm]) {
      svg(surface!, "line", {
        x1: 0,
        x2: w,
        y1: tempoY(bpm),
        y2: tempoY(bpm),
        class: "ref",
      });
      text(surface!, w, tempoY(bpm) - 4, `${bpm}`, "end");
    }

    const aColumns = columns(WINDOW.start, LENGTH);
    const aLevels = waveLevels(aColumns, aTimes, 4).map(
      (level, i) => level * gainOf(aColumns[i]!).out,
    );
    bars(surface!, aColumns, aLevels, l.aWave, "wave dim");
    const aLit = svg(surface!, "g", { "clip-path": "url(#lvz-mix-clip)" });
    bars(aLit, aColumns, aLevels, l.aWave, "wave lit a");
    ticks(svg(surface!, "g"), aBeats, l.aGrid, "a");

    bLayer = svg(surface!, "g");
    builtLock = -1;

    const curves = [
      [(t: number) => gainOf(t).out, WINDOW.start, LENGTH, l.gain, "a"],
      [(t: number) => gainOf(t).in, 0, WINDOW.end, l.gain, "b"],
      [tempoOf, -PLAN.prerollS, WINDOW.end, l.tempo, "b"],
    ] as const;
    const dim = svg(surface!, "g");
    const lit = svg(surface!, "g", { "clip-path": "url(#lvz-mix-clip)" });
    for (const [fn, from, to, lane, tone] of curves) {
      const d = path(fn, from, to, lane);
      svg(dim, "path", { d, class: "line dim" });
      svg(lit, "path", { d, class: `line ${tone}` });
    }
    const lowsLevel = (db: number) => 1 + db / Math.abs(MIX.bass.cutDb);
    const lowsA = path(
      (t) => lowsLevel(lowsOf(t).out),
      WINDOW.start,
      LENGTH,
      l.lows,
    );
    const lowsB = path((t) => lowsLevel(lowsOf(t).in), 0, WINDOW.end, l.lows);
    const close = (d: string, from: number, to: number) =>
      `${d}L${toX(to).toFixed(1)} ${l.lows!.bottom}L${toX(from).toFixed(1)} ${
        l.lows!.bottom
      }Z`;
    svg(dim, "path", { d: lowsA, class: "line dim" });
    svg(dim, "path", { d: lowsB, class: "line dim" });
    svg(lit, "path", {
      d: close(lowsA, WINDOW.start, LENGTH),
      class: "area a",
    });
    svg(lit, "path", { d: close(lowsB, 0, WINDOW.end), class: "area b" });
    svg(lit, "path", { d: lowsA, class: "line a" });
    svg(lit, "path", { d: lowsB, class: "line b" });

    const marks = svg(surface!, "g");
    const half = toX(LENGTH / 2);
    const crossY = l.gain.bottom - Math.SQRT1_2 * (l.gain.bottom - l.gain.top);
    svg(marks, "line", {
      x1: half,
      x2: half,
      y1: crossY + 4,
      y2: l.gain.bottom - 14,
      class: "ref",
    });
    svg(marks, "circle", { cx: half, cy: crossY, r: 3, class: "mark" });
    text(
      marks,
      half,
      l.gain.bottom - 4,
      mobile ? "−3 dB · 50%" : "−3 dB · handoff at 50%",
      "middle",
    );
    const swapFrom = toX(LENGTH * (0.5 - PLAN.swapFraction / 2));
    const swapTo = toX(LENGTH * (0.5 + PLAN.swapFraction / 2));
    svg(marks, "path", {
      d: `M${swapFrom} ${l.lows.top - 2}h${swapTo - swapFrom}`,
      class: "bracket",
    });
    text(
      marks,
      swapTo + 6,
      l.lows.top - 7,
      mobile ? "swap 1/8" : "swap · 1/8 of the mix",
    );

    head = svg(surface!, "line", {
      y1: l.aWave.top - 2,
      y2: l.lows.bottom + 2,
      class: "head",
    });
    dotA = svg(surface!, "circle", { r: 3.5, class: "dot a" });
    dotB = svg(surface!, "circle", { r: 3.5, class: "dot b" });
    shown = "";
    render(current, true);
  }

  function readouts(frame: StoryFrame) {
    const { time, lock } = frame;
    const gains = gainOf(time);
    const k = swapProgress(PLAN, time / LENGTH);
    const phase =
      time < -PLAN.prerollS
        ? "cued"
        : lock >= 0.995
          ? "locked"
          : `${Math.round((1 - lock) * MIX.b.looseOffsetMs)} ms`;
    const lows = time < 0 || k <= 0 ? "A" : k >= 1 ? "B" : "A → B";
    const next = [
      phase,
      incomingTempo(PLAN, time).toFixed(1),
      gains.out.toFixed(2),
      gains.in.toFixed(2),
      lows,
    ];
    const key = next.join("|");
    if (key === shown) return;
    shown = key;
    if (out.phase) out.phase.textContent = next[0]!;
    if (out.tempo) out.tempo.textContent = next[1]!;
    if (out.gainA) out.gainA.textContent = next[2]!;
    if (out.gainB) out.gainB.textContent = next[3]!;
    if (out.lows) out.lows.textContent = next[4]!;
    out.barA?.style.setProperty("transform", `scaleX(${gains.out.toFixed(3)})`);
    out.barB?.style.setProperty("transform", `scaleX(${gains.in.toFixed(3)})`);
  }

  function render(p: number, force = false) {
    if (!width || !head || !clip || !lanes) return;
    const frame = reduced
      ? { time: LENGTH / 2, lock: 1, stage: -1, progress: 0.5 }
      : storyAt(PLAN, p);
    const lock = Math.round(frame.lock * 200) / 200;
    if (force || lock !== builtLock) buildIncoming(lock);
    const x = toX(frame.time);
    clip.setAttribute("width", (reduced ? width : x).toFixed(1));
    head.setAttribute("x1", x.toFixed(1));
    head.setAttribute("x2", x.toFixed(1));
    const inMix = frame.time > 0 && frame.time < LENGTH;
    const gains = gainOf(frame.time);
    const gain = lanes.gain;
    for (const [dot, value] of [
      [dotA, gains.out],
      [dotB, gains.in],
    ] as const) {
      dot!.style.opacity = inMix ? "1" : "0";
      dot!.setAttribute("cx", x.toFixed(1));
      dot!.setAttribute(
        "cy",
        (gain.bottom - value * (gain.bottom - gain.top)).toFixed(1),
      );
    }
    readouts(frame);
    if (frame.stage !== stage) {
      stage = frame.stage;
      stages.forEach((item, i) => {
        item.classList.toggle("is-on", i === stage);
        item.classList.toggle("is-done", i < stage);
      });
    }
  }

  const stopResize = observeSize(surface, (w, h) => build(w, h));
  if (reduced) return stopResize;

  root.classList.add("is-running");
  const pinTop = () => parseFloat(getComputedStyle(pin).top) || 0;
  const trigger = ScrollTrigger.create({
    trigger: scroller,
    start: () => `top ${pinTop()}px`,
    end: () => `bottom ${pinTop() + pin.offsetHeight}px`,
    invalidateOnRefresh: true,
    onUpdate: (self) => (target = self.progress),
  });
  target = trigger.progress;
  current = target;
  render(current);

  const loop = visibleLoop(root, (_, dt) => {
    if (current === target) return;
    current += (target - current) * Math.min(1, dt * 9);
    if (Math.abs(target - current) < 0.0004) current = target;
    render(current);
  });

  return () => {
    stopResize();
    loop.cleanup();
    trigger.kill();
    root.classList.remove("is-running");
    stages.forEach((item) => item.classList.remove("is-on", "is-done"));
  };
}
