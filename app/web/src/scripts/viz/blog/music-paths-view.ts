// TEST_GAP: positioned HTML over a stretched SVG and the visible loop need a real
// browser; the selection frames are covered in music-paths.test.ts and the figure
// in e2e/blog-music-path.spec.ts.
import type { Cleanup } from "../../motion/page";
import {
  MUSIC_PATHS_TRACKS,
  pathsFrame,
  pathsReadout,
  VIEW,
  type PathLane,
} from "./music-paths";
import { initPhaseLoop } from "./phase-loop";

const DESTINATION_TEXT = {
  pending: "destination",
  reserved: "reserved",
  appended: "appended",
} as const;

const percent = (x: number) => `${((x / VIEW.width) * 100).toFixed(2)}%`;

function setAttr(node: Element | null | undefined, name: string, value: string) {
  if (node && node.getAttribute(name) !== value) node.setAttribute(name, value);
}

function setText(node: HTMLElement | null | undefined, value: string) {
  if (node && node.textContent !== value) node.textContent = value;
}

function setTone(node: HTMLElement | null | undefined, tone: string | undefined) {
  if (!node) return;
  if (tone) node.dataset.tone = tone;
  else delete node.dataset.tone;
}

export function initMusicPaths(root: HTMLElement): Cleanup {
  const scene = root.querySelector<HTMLElement>(".mp");
  if (!scene) return () => {};
  let lanes: PathLane[];
  try {
    lanes = JSON.parse(scene.dataset.mpLanes ?? "[]") as PathLane[];
  } catch {
    return () => {};
  }

  const views = lanes.map((lane, i) => {
    const el = root.querySelector<HTMLElement>(`[data-mp-lane="${i}"]`);
    const all = <T extends Element>(selector: string) => [
      ...(el?.querySelectorAll<T>(selector) ?? []),
    ];
    const byId = <T extends HTMLElement>(selector: string, key: string) =>
      new Map(all<T>(selector).map((node) => [Number(node.dataset[key]), node]));
    return {
      lane,
      origin: el?.querySelector("[data-mp-origin]"),
      destination: el?.querySelector("[data-mp-destination]"),
      destinationText: el?.querySelector<HTMLElement>("[data-mp-destination-text]"),
      slots: all<HTMLElement>("[data-mp-slot]"),
      stepLabels: byId<HTMLElement>("[data-mp-step-label]", "mpStepLabel"),
      group: el?.querySelector<HTMLElement>("[data-mp-group]"),
      pills: byId<HTMLElement>("[data-mp-pill]", "mpPill"),
      chips: byId<HTMLElement>("[data-mp-chip]", "mpChip"),
      route: root.querySelector(`[data-mp-route="${i}"]`),
      drop: root.querySelector<SVGLineElement>(`[data-mp-drop="${i}"]`),
      readout: root.querySelector<HTMLElement>(`[data-mp-ro="${lane.id}"]`),
      count: root.querySelector<HTMLElement>(
        `[data-mp-ro="${lane.id}"] [data-mp-count]`,
      ),
      empty: root.querySelector<HTMLElement>(
        `[data-mp-ro="${lane.id}"] [data-mp-empty]`,
      ),
    };
  });
  const head = root.querySelector<SVGLineElement>("[data-mp-head]");
  const destinationReadout = root.querySelector<HTMLElement>(
    '[data-mp-ro="destination"]',
  );

  return initPhaseLoop(root, {
    tracks: MUSIC_PATHS_TRACKS,
    initial: "anchor-first",
    render: ({ time }) => {
      const frame = pathsFrame(lanes, time);
      const values = pathsReadout(lanes, frame);

      if (head) {
        head.style.opacity = frame.sweep === null ? "0" : "1";
        if (frame.sweep !== null) {
          setAttr(head, "x1", frame.sweep.toFixed(1));
          setAttr(head, "x2", frame.sweep.toFixed(1));
        }
      }

      views.forEach((view, i) => {
        const state = frame.lanes[i]!;
        setAttr(view.origin, "data-state", state.origin);
        setAttr(view.destination, "data-state", state.destination);
        setAttr(view.destinationText, "data-state", state.destination);
        setText(view.destinationText, DESTINATION_TEXT[state.destination]);
        view.slots.forEach((slot, s) => setAttr(slot, "data-state", state.slots[s]!));
        for (const [step, label] of view.stepLabels)
          setAttr(label, "data-state", state.slots[step]!);

        for (const pill of state.pills) {
          const node = view.pills.get(pill.id);
          setAttr(node, "data-state", pill.state);
          setAttr(node, "style", `order:${pill.order}`);
        }
        if (view.group) {
          view.group.style.opacity = state.group ? "1" : "0";
          if (state.group) {
            view.group.style.left = percent(state.group.x);
            view.group.style.setProperty("--lead", String(state.group.lead));
          }
        }
        for (const chip of state.chips)
          setAttr(view.chips.get(chip.id), "data-state", chip.state);

        setAttr(view.route, "d", state.route);
        if (view.drop) {
          view.drop.style.opacity = state.drop === null ? "0" : "1";
          if (state.drop !== null) {
            setAttr(view.drop, "x1", String(state.drop));
            setAttr(view.drop, "x2", String(state.drop));
          }
        }

        const value = values.lanes[i]!;
        setText(view.count, value.text);
        setText(view.empty, value.empty ? `${value.empty} empty` : "");
        setTone(view.readout, value.tone);
      });

      setText(destinationReadout, values.destination.text);
      setTone(destinationReadout, values.destination.tone);
    },
  });
}
