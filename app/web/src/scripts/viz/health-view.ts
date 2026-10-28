import { reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";
import { visibleLoop } from "./loop";

const STEP = 0.3;
const SETTLE = 0.7;
const HOLD = 4.2;

export function initHealth(root: HTMLElement): Cleanup {
  const rows = [...root.querySelectorAll<HTMLElement>("[data-check]")];
  const status = root.querySelector<HTMLElement>("[data-scan-status]");
  if (!rows.length || reducedMotion()) return () => {};
  const finalStatus = status?.textContent ?? "";
  const found = rows.map((row) => Number(row.dataset.findings ?? 0));
  const results = rows.map((row) => row.querySelector<HTMLElement>(".result")!);
  const finals = results.map((result) => result.textContent ?? "");
  const scanEnd = rows.length * STEP;
  const cycle = scanEnd + SETTLE + HOLD;
  const shown: string[] = [];
  let clock = 0;
  let statusShown = "";

  const setRow = (
    index: number,
    state: string,
    text: string,
    scanning: boolean,
  ) => {
    const key = `${state}|${scanning}`;
    if (shown[index] === key) return;
    shown[index] = key;
    const row = rows[index]!;
    row.dataset.state = state;
    row.classList.toggle("is-scanning", scanning);
    results[index]!.textContent = text;
  };

  const setStatus = (text: string) => {
    if (text === statusShown || !status) return;
    statusShown = text;
    status.textContent = text;
  };

  const render = (t: number) => {
    const settled = t >= scanEnd + SETTLE;
    rows.forEach((row, i) => {
      const start = i * STEP;
      if (t < start) return setRow(i, "pending", "", false);
      if (t < start + STEP) return setRow(i, "pending", "", true);
      if (!found[i]) return setRow(i, "clean", "clean", false);
      if (!settled) return setRow(i, "found", `${found[i]} found`, false);
      setRow(
        i,
        row.dataset.confirm !== undefined ? "waiting" : "fixed",
        finals[i]!,
        false,
      );
    });
    if (t < scanEnd) {
      setStatus(
        `scanning ${String(
          Math.min(rows.length, Math.floor(t / STEP) + 1),
        ).padStart(2, "0")}/${rows.length}`,
      );
    } else setStatus(settled ? finalStatus : "applying automatic fixes");
  };

  const loop = visibleLoop(
    root,
    (_, dt) => {
      clock = (clock + dt) % cycle;
      render(clock);
    },
    { onFirstVisible: () => (clock = 0) },
  );

  return () => {
    loop.cleanup();
    rows.forEach((row, i) =>
      setRow(
        i,
        row.dataset.confirm !== undefined && found[i]
          ? "waiting"
          : found[i]
            ? "fixed"
            : "clean",
        finals[i]!,
        false,
      ),
    );
    setStatus(finalStatus);
  };
}
