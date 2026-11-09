// TEST_GAP: clip paths and the visible loop need a real browser; the gain model
// is covered in crossfade.test.ts and the figure in e2e/blog-crossfade.spec.ts.
import type { Cleanup } from "../../motion/page";
import {
  CROSSFADE_TRACKS,
  crossfadeReadout,
  storyTime,
  toX,
  WINDOW,
  type CrossfadeState,
} from "./crossfade";
import { initPhaseLoop } from "./phase-loop";

export function initCrossfade(root: HTMLElement): Cleanup {
  const scene = root.querySelector<HTMLElement>(".cf");
  const clip = root.querySelector<SVGRectElement>("[data-cf-clip]");
  const head = root.querySelector<SVGLineElement>("[data-cf-head]");
  if (!scene || !clip || !head) return () => {};
  const out = (key: string) =>
    root.querySelector<HTMLElement>(`[data-cf-ro="${key}"]`);
  const fields = {
    gainA: out("gainA"),
    gainB: out("gainB"),
    ui: out("ui"),
    beats: out("beats"),
    output: out("output"),
  };
  const set = (node: HTMLElement | null, value: string, tone?: string) => {
    if (!node) return;
    if (node.textContent !== value) node.textContent = value;
    if (tone) node.dataset.tone = tone;
    else delete node.dataset.tone;
  };

  return initPhaseLoop(root, {
    tracks: CROSSFADE_TRACKS,
    initial: "timer",
    render: ({ state, time }) => {
      const s = storyTime(time);
      const x = toX(Math.max(WINDOW.start, s)).toFixed(1);
      clip.setAttribute("width", x);
      head.setAttribute("x1", x);
      head.setAttribute("x2", x);
      const values = crossfadeReadout(state as CrossfadeState, s);
      scene.dataset.ui = values.ui.tone === "warn" ? "busy" : "idle";
      set(fields.gainA, values.gainA);
      set(fields.gainB, values.gainB);
      set(fields.ui, values.ui.text, values.ui.tone);
      set(fields.beats, values.beats.text, values.beats.tone);
      set(fields.output, values.output);
    },
  });
}
