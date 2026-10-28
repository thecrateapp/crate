import { reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";
import { visibleLoop } from "./loop";

const RATE = 16;
const HOLD = 1.2;
const SWEEP = 2.4;
const REST = 2.6;

export function initSidecar(root: HTMLElement): Cleanup {
  const scroller = root.querySelector<HTMLElement>("[data-sidecar-scroll]");
  const lines = [...root.querySelectorAll<HTMLElement>("[data-line]")];
  const write = root.querySelector<HTMLElement>('[data-flow="write"]');
  const rehydrate = root.querySelector<HTMLElement>('[data-flow="rehydrate"]');
  if (!scroller || !lines.length || reducedMotion()) return () => {};
  const listeners = new AbortController();
  const typeEnd = lines.length / RATE;
  const cycle = typeEnd + HOLD + SWEEP + REST;
  let clock = 0;
  let typed = -1;
  let lit = -1;
  let follow = true;

  const stopFollowing = () => (follow = false);
  scroller.addEventListener("wheel", stopFollowing, {
    signal: listeners.signal,
    passive: true,
  });
  scroller.addEventListener("pointerdown", stopFollowing, {
    signal: listeners.signal,
  });
  scroller.addEventListener("keydown", stopFollowing, {
    signal: listeners.signal,
  });

  const reveal = (count: number) => {
    if (count === typed) return;
    lines.forEach((line, i) => line.classList.toggle("is-on", i < count));
    typed = count;
  };

  const highlight = (index: number) => {
    if (index === lit) return;
    lines[lit]?.classList.remove("is-last");
    lines[index]?.classList.add("is-last");
    lit = index;
  };

  const scrollTo = (index: number, dt: number) => {
    if (!follow) return;
    const line = lines[Math.max(0, Math.min(lines.length - 1, index))]!;
    const target = Math.max(0, line.offsetTop - scroller.clientHeight * 0.6);
    scroller.scrollTop +=
      (target - scroller.scrollTop) * (1 - Math.exp(-dt * 8));
  };

  const loop = visibleLoop(
    root,
    (_, dt) => {
      clock = (clock + dt) % cycle;
      const t = clock;
      scroller.classList.add("is-typing");
      if (t < typeEnd) {
        const count = Math.min(lines.length, Math.floor(t * RATE) + 1);
        reveal(count);
        highlight(count - 1);
        scrollTo(count - 1, dt);
        write?.style.setProperty("--p", (t / typeEnd).toFixed(3));
        rehydrate?.style.setProperty("--p", "0");
        return;
      }
      reveal(lines.length);
      write?.style.setProperty("--p", "1");
      const sweep = (t - typeEnd - HOLD) / SWEEP;
      if (sweep >= 0 && sweep <= 1) {
        const index = Math.floor(sweep * (lines.length - 1));
        highlight(index);
        scrollTo(index, dt);
        rehydrate?.style.setProperty("--p", sweep.toFixed(3));
      } else if (sweep > 1) {
        highlight(-1);
        rehydrate?.style.setProperty("--p", "1");
      } else {
        highlight(-1);
        rehydrate?.style.setProperty("--p", "0");
      }
    },
    { onFirstVisible: () => (clock = 0) },
  );

  return () => {
    listeners.abort();
    loop.cleanup();
    scroller.classList.remove("is-typing");
    highlight(-1);
    write?.style.removeProperty("--p");
    rehydrate?.style.removeProperty("--p");
  };
}
