// TEST_GAP: pill motion, CSS transitions and the visible loop need a real
// browser; the admission model is covered in workers.test.ts and the figure in
// e2e/blog-workers.spec.ts.
import type { Cleanup } from "../../motion/page";
import { initPhaseLoop } from "./phase-loop";
import {
  GAUGES,
  gaugeText,
  sceneLabels,
  WORKERS_TRACKS,
  workersFrame,
  workersReadout,
  type Lane,
} from "./workers";

const LANES: Lane[] = ["maintenance", "analysis", "playback"];
const READOUTS = ["governor", "repair", "playback", "interrupted"] as const;

export function initWorkers(root: HTMLElement): Cleanup {
  const scene = root.querySelector<HTMLElement>(".wk");
  if (!scene) return () => {};
  const one = <T extends Element = HTMLElement>(selector: string) =>
    root.querySelector<T>(selector);

  const jobs = [...root.querySelectorAll<HTMLElement>("[data-wk-job]")].map(
    (element) => ({
      element,
      id: element.dataset.wkJob!,
      cells: [...element.querySelectorAll<HTMLElement>("i")],
      delay: element.querySelector<HTMLElement>("[data-wk-delay]"),
    }),
  );
  const plays = [
    ...root.querySelectorAll<SVGGElement>("[data-wk-play]"),
  ].map((group) => ({
    group,
    id: group.dataset.wkPlay!,
    rect: group.querySelector("rect")!,
    end: group.querySelector("line")!,
  }));
  const gauges = GAUGES.map((gauge) => {
    const element = one(`[data-wk-gauge="${gauge.id}"]`);
    return { gauge, element, output: element?.querySelector("output") };
  });
  const gates = {
    maintenance: one('[data-wk-gate="maintenance"]'),
    analysis: one('[data-wk-gate="analysis"]'),
  };
  const done = Object.fromEntries(
    LANES.map((lane) => [lane, one(`[data-wk-done="${lane}"]`)]),
  ) as Record<Lane, HTMLElement | null>;
  const field = {
    clock: one("[data-wk-clock]"),
    verdict: one("[data-wk-verdict]"),
    reason: one("[data-wk-reason]"),
    users: one('[data-wk-count="users"]'),
    streams: one('[data-wk-count="streams"]'),
    arc: one<SVGSVGElement>("[data-wk-arc]"),
    arcLabel: one("[data-wk-arc-label]"),
    sleep: one("[data-wk-sleep]"),
  };
  const readouts = READOUTS.map((key) => {
    const dd = one(`[data-wk-ro="${key}"]`);
    return {
      key,
      dd,
      value: dd?.querySelector("span") ?? null,
      note: dd?.querySelector("small") ?? null,
    };
  });

  const setText = (node: Element | null | undefined, value: string) => {
    if (node && node.textContent !== value) node.textContent = value;
  };
  const setData = (node: Element | null | undefined, key: string, value?: string) => {
    if (!(node instanceof HTMLElement || node instanceof SVGElement)) return;
    if (value === undefined) delete node.dataset[key];
    else if (node.dataset[key] !== value) node.dataset[key] = value;
  };

  return initPhaseLoop(root, {
    tracks: WORKERS_TRACKS,
    initial: "admission",
    render: ({ time }) => {
      const frame = workersFrame(time);
      const text = sceneLabels(frame);
      setData(scene, "verdict", frame.decision.allowed ? "allow" : "defer");
      setData(scene, "listening", String(frame.activity.listening));

      setText(field.clock, text.clock);
      setText(field.verdict, text.verdict);
      setText(field.reason, text.reason);
      setText(field.users, text.users);
      setText(field.streams, text.streams);
      setData(field.users, "on", String(frame.activity.users > 0));
      setData(field.streams, "on", String(frame.activity.streams > 0));

      for (const { group, id, rect, end } of plays) {
        const play = frame.activity.plays.find((item) => item.id === id)!;
        group.style.display = play.visible ? "" : "none";
        setData(group, "recorded", String(play.recorded));
        rect.setAttribute("x", play.x0.toFixed(1));
        rect.setAttribute("width", Math.max(0, play.x1 - play.x0).toFixed(1));
        end.setAttribute("x1", play.x1.toFixed(1));
        end.setAttribute("x2", play.x1.toFixed(1));
      }

      for (const { gauge, element, output } of gauges) {
        const value = frame.gauges[gauge.id];
        element?.style.setProperty("--v", Math.min(1, value / gauge.max).toFixed(3));
        setText(output, gaugeText(gauge, value));
      }

      for (const { element, id, cells, delay } of jobs) {
        const job = frame.jobs.find((item) => item.id === id)!;
        element.style.left = `${job.x.toFixed(2)}%`;
        element.style.opacity = job.opacity.toFixed(2);
        element.style.setProperty("--p", job.progress.toFixed(3));
        setData(element, "state", job.state);
        cells.forEach((cell, i) => setData(cell, "on", String(i < job.cells)));
        if (delay) setText(delay, text.delay && ` · ${text.delay}`);
      }

      const deferred = frame.jobs.find((job) => job.id === "repair-next")!.state === "deferred";
      setData(field.arc, "on", String(deferred));
      setData(field.arcLabel, "on", String(deferred));
      setText(field.arcLabel, text.arc);
      setData(field.sleep, "on", String(frame.lanes.analysis.sleeping));
      setText(field.sleep, text.sleep);
      for (const lane of ["maintenance", "analysis"] as const) {
        setData(gates[lane], "gate", frame.lanes[lane].gate);
        setData(gates[lane], "check", String(frame.lanes[lane].checking));
      }
      for (const lane of LANES) setText(done[lane], text.done[lane]);

      const values = workersReadout(frame);
      for (const { key, dd, value, note } of readouts) {
        setText(value, values[key].text);
        setText(note, values[key].note);
        setData(dd, "tone", values[key].tone);
      }
    },
  });
}

