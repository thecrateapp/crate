import { reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";
import { governorSnapshot } from "./governor-math";
import { GOVERNOR_PERIOD, gaugeRenderer } from "./governor-view";
import { observeSize, visibleLoop } from "./loop";

const LANES: Record<string, { spawn: number; run: number; slots: number }> = {
  maintenance: { spawn: 1.3, run: 2.8, slots: 2 },
  default: { spawn: 1.7, run: 2.2, slots: 2 },
  fast: { spawn: 0.9, run: 1.1, slots: 3 },
  heavy: { spawn: 3.6, run: 4.2, slots: 1 },
  playback: { spawn: 2.6, run: 1.4, slots: 1 },
};
const MAX_CHIPS = 7;
const GAP = 6;

interface Pick {
  name: string;
  governed: boolean;
}

interface Chip {
  element: HTMLElement;
  governed: boolean;
  state: "queued" | "running" | "done";
  x: number;
  width: number;
  startedAt: number;
  doneAt: number;
  deferred: boolean;
}

interface Lane {
  track: HTMLElement;
  template: HTMLElement;
  picks: Pick[];
  config: { spawn: number; run: number; slots: number };
  chips: Chip[];
  next: number;
  pick: number;
  width: number;
}

export function initQueues(root: HTMLElement): Cleanup {
  const lanes: Lane[] = [
    ...root.querySelectorAll<HTMLElement>("[data-queue]"),
  ].flatMap((element) => {
    const track = element.querySelector<HTMLElement>(".lane-track");
    const chip = track?.querySelector<HTMLElement>("[data-chip]");
    const config = LANES[element.dataset.queue ?? ""];
    if (!track || !chip || !config) return [];
    return [
      {
        track,
        template: chip.cloneNode(false) as HTMLElement,
        picks: JSON.parse(element.dataset.picks ?? "[]") as Pick[],
        config,
        chips: [],
        next: Math.random() * config.spawn,
        pick: 0,
        width: track.clientWidth,
      },
    ];
  });
  const governor = root.querySelector<HTMLElement>("[data-governor]");
  if (!lanes.length || !governor || reducedMotion()) return () => {};
  const render = gaugeRenderer(governor);
  const resizes = lanes.map((lane) =>
    observeSize(lane.track, (width) => (lane.width = width)),
  );
  let time = 0;

  const spawn = (lane: Lane) => {
    const pick = lane.picks[lane.pick % lane.picks.length]!;
    lane.pick += 1;
    const element = lane.template.cloneNode(false) as HTMLElement;
    element.classList.toggle("gov", pick.governed);
    element.textContent = pick.name;
    element.style.cssText = "left:0";
    lane.track.appendChild(element);
    const width = element.offsetWidth;
    lane.chips.push({
      element,
      governed: pick.governed,
      state: "queued",
      x: -width,
      width,
      startedAt: 0,
      doneAt: 0,
      deferred: false,
    });
  };

  const statics = lanes.flatMap((lane) => [
    ...lane.track.querySelectorAll<HTMLElement>("[data-chip]"),
  ]);
  statics.forEach((chip) => chip.remove());

  const step = (lane: Lane, dt: number, blocked: boolean) => {
    const { config, width } = lane;
    const queueEnd = width * 0.34 - GAP;
    const runStart = width * 0.34 + 8;
    const runEnd = width * 0.84 - 8;
    if (time >= lane.next && lane.chips.length < MAX_CHIPS) {
      spawn(lane);
      lane.next = time + config.spawn * (0.75 + Math.random() * 0.5);
    }
    let running = lane.chips.filter((chip) => chip.state === "running").length;
    const queued = lane.chips.filter((chip) => chip.state === "queued");
    const front = queued[0];
    const slots = width < 500 ? 1 : config.slots;
    if (
      front &&
      running < slots &&
      !(front.governed && blocked) &&
      front.x > queueEnd - front.width - 24
    ) {
      front.state = "running";
      front.startedAt = time;
      running += 1;
    }
    let cursor = queueEnd;
    const ease = 1 - Math.exp(-dt * 7);
    for (const chip of lane.chips) {
      let target = chip.x;
      if (chip.state === "queued") {
        target = cursor - chip.width;
        cursor = target - GAP;
        const deferred = chip === front && chip.governed && blocked;
        if (deferred !== chip.deferred) {
          chip.deferred = deferred;
          chip.element.classList.toggle("is-deferred", deferred);
        }
      } else if (chip.state === "running") {
        const progress = Math.min(1, (time - chip.startedAt) / config.run);
        target =
          runStart + progress * Math.max(0, runEnd - runStart - chip.width);
        chip.element.style.setProperty(
          "--p",
          `${(progress * 100).toFixed(1)}%`,
        );
        if (chip.deferred) {
          chip.deferred = false;
          chip.element.classList.remove("is-deferred");
        }
        if (progress >= 1) {
          chip.state = "done";
          chip.doneAt = time;
          chip.element.classList.add("is-done");
        }
      } else {
        target = width * 0.84 + 8;
        chip.element.style.opacity = Math.max(
          0,
          1 - (time - chip.doneAt) / 0.9,
        ).toFixed(3);
      }
      chip.x += (target - chip.x) * ease;
      chip.element.style.transform = `translateX(${chip.x.toFixed(1)}px)`;
    }
    lane.chips = lane.chips.filter((chip) => {
      const gone = chip.state === "done" && time - chip.doneAt > 0.9;
      if (gone) chip.element.remove();
      return !gone;
    });
  };

  const loop = visibleLoop(root, (_, dt) => {
    time += dt;
    const reasons = render(
      governorSnapshot((time % GOVERNOR_PERIOD) / GOVERNOR_PERIOD),
    );
    lanes.forEach((lane) => step(lane, dt, reasons.length > 0));
  });

  return () => {
    loop.cleanup();
    resizes.forEach((stop) => stop());
    lanes.forEach((lane) =>
      lane.chips.forEach((chip) => chip.element.remove()),
    );
    lanes.forEach(
      (lane, i) => statics[i] && lane.track.appendChild(statics[i]!),
    );
  };
}
