import { typedAt } from "../../lib/json-lines";
import { reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";
import { visibleLoop } from "./loop";

const TYPE_RATE = 38;
const WAIT = 0.45;
const LINE_RATE = 14;
const HOLD = 4.5;

export function initTerminal(root: HTMLElement): Cleanup {
  const command = root.querySelector<HTMLElement>("[data-term-command]");
  const status = root.querySelector<HTMLElement>("[data-term-status]");
  const lines = [...root.querySelectorAll<HTMLElement>("[data-term-line]")];
  if (!command || !status || reducedMotion()) return () => {};
  const text = command.dataset.text ?? command.textContent ?? "";
  const typeEnd = text.length / TYPE_RATE;
  const linesStart = typeEnd + WAIT;
  const cycle = linesStart + lines.length / LINE_RATE + HOLD;
  let clock = 0;
  let typed = "";
  let shown = -1;

  const render = (t: number) => {
    const next = typedAt(text, t, TYPE_RATE);
    if (next !== typed) {
      typed = next;
      command.textContent = next;
    }
    root.classList.toggle("is-typing", t < linesStart);
    status.classList.toggle("is-on", t >= linesStart);
    const count =
      t < linesStart
        ? 0
        : Math.min(lines.length, Math.floor((t - linesStart) * LINE_RATE) + 1);
    if (count !== shown) {
      shown = count;
      lines.forEach((line, i) => line.classList.toggle("is-on", i < count));
    }
  };

  const loop = visibleLoop(
    root,
    (_, dt) => {
      clock = (clock + dt) % cycle;
      root.classList.add("is-running");
      render(clock);
    },
    { onFirstVisible: () => (clock = 0) },
  );

  return () => {
    loop.cleanup();
    root.classList.remove("is-running", "is-typing");
    command.textContent = text;
  };
}
