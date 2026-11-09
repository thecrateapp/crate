// TEST_GAP: clip paths, lens ribbons and the visible loop need a real browser;
// the planner rules and frames are covered in smart-mix.test.ts and the figure
// in e2e/blog-smart-mix.spec.ts.
import type { Cleanup } from "../../motion/page";
import { initPhaseLoop } from "./phase-loop";
import {
  sceneGeometry,
  SMART_MIX_TRACKS,
  smartMixFrame,
  smartMixReadout,
  type Extent,
  type ReadoutValue,
  type SmartMixData,
  type SmartMixState,
} from "./smart-mix";

const f = (value: number) => value.toFixed(1);
const READOUTS = ["aligned", "clash", "aUnplayed", "bSkipped"] as const;

export function initSmartMix(root: HTMLElement): Cleanup {
  const scene = root.querySelector<HTMLElement>(".sm");
  const raw = scene?.dataset.smData;
  if (!scene || !raw) return () => {};
  const data = JSON.parse(raw) as SmartMixData;
  const one = <T extends Element>(selector: string) =>
    root.querySelector<T>(selector);
  const clips = Object.fromEntries(
    ["aPlay", "aWin", "bPlay", "bWin", "extent", "lit"].map((key) => [
      key,
      one<SVGRectElement>(`[data-sm-clip="${key}"]`),
    ]),
  );
  const zones = {
    a: one<SVGRectElement>('[data-sm-zone="a"]'),
    b: one<SVGRectElement>('[data-sm-zone="b"]'),
    mix: one<SVGRectElement>('[data-sm-zone="mix"]'),
  };
  const omit = {
    a: one<SVGRectElement>('[data-sm-omit="a"]'),
    b: one<SVGRectElement>('[data-sm-omit="b"]'),
  };
  const lens = {
    a: one<SVGPathElement>('[data-sm-lens="a"]'),
    b: one<SVGPathElement>('[data-sm-lens="b"]'),
  };
  const heads = {
    a: one<SVGLineElement>('[data-sm-head="a"]'),
    b: one<SVGLineElement>('[data-sm-head="b"]'),
    mix: one<SVGLineElement>('[data-sm-head="mix"]'),
  };
  const edges = [...root.querySelectorAll<SVGLineElement>("[data-sm-edge]")];
  const ranges = {
    a: one<HTMLElement>('[data-sm-range="a"]'),
    b: one<HTMLElement>('[data-sm-range="b"]'),
  };
  const mixName = one<HTMLElement>("[data-sm-mix-name]");
  const mixDetail = one<HTMLElement>("[data-sm-mix-detail]");
  const fields = Object.fromEntries(
    READOUTS.map((key) => [
      key,
      {
        dd: one<HTMLElement>(`[data-sm-dd="${key}"]`),
        value: one<HTMLElement>(`[data-sm-ro="${key}"]`),
        unit: one<HTMLElement>(`[data-sm-unit="${key}"]`),
      },
    ]),
  );

  const text = (node: HTMLElement | null, value: string) => {
    if (node && node.textContent !== value) node.textContent = value;
  };
  const span = (node: SVGRectElement | null, { x, width }: Extent) => {
    node?.setAttribute("x", f(x));
    node?.setAttribute("width", f(width));
  };
  const at = (node: SVGLineElement | null, x: number) => {
    node?.setAttribute("x1", f(x));
    node?.setAttribute("x2", f(x));
  };
  const flag = (key: string, on: boolean, values = ["on", "off"]) => {
    scene.dataset[key] = on ? values[0] : values[1];
  };

  return initPhaseLoop(root, {
    tracks: SMART_MIX_TRACKS,
    initial: "v3",
    render: ({ state, time }) => {
      const frame = smartMixFrame(data, state as SmartMixState, time);
      const geo = sceneGeometry(data, frame);
      scene.dataset.plan = frame.plan.id;
      flag("structure", frame.structure);
      flag("voice", frame.voiceKnown, ["known", "unknown"]);
      flag("candidates", frame.candidates);
      flag("grid", frame.grid);
      flag("cues", frame.cues);
      flag("ghost", frame.ghost);
      flag("bounds", frame.bounds);
      flag("sweep", geo.heads !== null);
      flag("clash", geo.clash);

      span(clips.aPlay!, geo.aPlay);
      span(clips.aWin!, geo.aWin);
      span(zones.a, geo.aWin);
      span(clips.bPlay!, geo.bPlay);
      span(clips.bWin!, geo.bWin);
      span(zones.b, geo.bWin);
      span(omit.a, geo.aOmit);
      span(omit.b, geo.bOmit);
      span(clips.extent!, { x: 0, width: geo.extent });
      span(zones.mix, { x: 0, width: geo.extent });
      span(clips.lit!, { x: 0, width: geo.lit });
      lens.a?.setAttribute("d", geo.lensA);
      lens.b?.setAttribute("d", geo.lensB);
      if (geo.heads) {
        at(heads.a, geo.heads.a);
        at(heads.b, geo.heads.b);
        at(heads.mix, geo.heads.mix);
      }
      geo.edges.forEach((edge, i) => {
        at(edges[i] ?? null, edge.x);
        edges[i]?.setAttribute("data-aligned", String(edge.aligned));
      });
      for (const key of ["a", "b"] as const) {
        const node = ranges[key];
        if (!node) continue;
        node.style.left = `${geo.ranges[key].left.toFixed(2)}%`;
        node.dataset.anchor = geo.ranges[key].anchor;
        text(node, geo.ranges[key].text);
      }
      text(mixName, geo.mix.name);
      text(mixDetail, geo.mix.detail);

      const readout = smartMixReadout(data, frame);
      for (const key of READOUTS) {
        const value: ReadoutValue = readout[key];
        const field = fields[key]!;
        text(field.value, value.value);
        text(field.unit, value.unit);
        if (!field.dd) continue;
        if (value.tone) field.dd.dataset.tone = value.tone;
        else delete field.dd.dataset.tone;
      }
    },
  });
}
