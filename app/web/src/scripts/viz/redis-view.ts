import { reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";
import { visibleLoop } from "./loop";

const SET_EVERY = 0.42;
const WRITE_EVERY = 0.7;
const HIGH_WATER = 36;
const LOG_LINES = 6;

export function initRedis(root: HTMLElement): Cleanup {
  const cells = [...root.querySelectorAll<HTMLElement>(".cells li")];
  const fill = root.querySelector<HTMLElement>("[data-cache-fill]");
  const fillText = root.querySelector<HTMLElement>("[data-cache-text]");
  const log = root.querySelector<HTMLElement>("[data-cache-log]");
  const aof = root.querySelector<HTMLElement>("[data-aof]");
  const fsync = root.querySelector<HTMLElement>("[data-fsync]");
  const data = root.querySelector<HTMLScriptElement>("[data-redis-data]");
  if (!cells.length || !log || !aof || !data || reducedMotion())
    return () => {};
  const { keys, writes } = JSON.parse(data.textContent ?? "{}") as {
    keys: string[];
    writes: string[];
  };
  const logTemplate = log.firstElementChild!.cloneNode(false) as HTMLElement;
  const aofTemplate = aof.firstElementChild!.cloneNode(false) as HTMLElement;
  const initialLog = log.innerHTML;
  const initialAof = aof.innerHTML;
  const initialCells = cells.map((cell) => cell.className);
  const max = fillText?.textContent?.split(" of ")[1] ?? "";
  const used = new Map<HTMLElement, { key: string; at: number }>();
  let clock = 0;
  let nextSet = 0;
  let nextWrite = 0;
  let keyIndex = 0;
  let writeIndex = 0;

  cells.forEach(
    (cell, i) =>
      cell.classList.contains("on") &&
      used.set(cell, { key: keys[i % keys.length]!, at: -i }),
  );

  const push = (
    list: HTMLElement,
    template: HTMLElement,
    text: string,
    first: boolean,
    extra?: string,
  ) => {
    const item = template.cloneNode(false) as HTMLElement;
    item.textContent = text;
    if (extra) item.classList.add(extra);
    if (first) list.prepend(item);
    else list.append(item);
    while (list.children.length > LOG_LINES)
      (first ? list.lastElementChild : list.firstElementChild)!.remove();
  };

  const tick = () => {
    if (used.size >= HIGH_WATER) {
      const [cell, entry] = [...used]
        .filter(([candidate]) => candidate.classList.contains("ttl"))
        .sort((a, b) => a[1].at - b[1].at)[0]!;
      used.delete(cell);
      cell.classList.add("out");
      setTimeout(() => cell.classList.remove("on", "out"), 360);
      push(log, logTemplate, `evict ${entry.key}`, true, "evict");
      return;
    }
    const free = cells.filter(
      (cell) => !used.has(cell) && !cell.classList.contains("out"),
    );
    const cell = free[Math.floor(Math.random() * free.length)];
    if (!cell) return;
    const key = keys[keyIndex++ % keys.length]!;
    used.set(cell, { key, at: clock });
    cell.classList.add("on");
    push(
      log,
      logTemplate,
      cell.classList.contains("ttl") ? `set ${key} EX 300` : `set ${key}`,
      true,
    );
  };

  const loop = visibleLoop(root, (_, dt) => {
    clock += dt;
    if (clock >= nextSet) {
      nextSet = clock + SET_EVERY;
      tick();
      const ratio = used.size / cells.length;
      fill?.style.setProperty("--v", ratio.toFixed(3));
      if (fillText)
        fillText.textContent = `${Math.round(ratio * 100)}% of ${max}`;
    }
    if (clock >= nextWrite) {
      nextWrite = clock + WRITE_EVERY;
      push(aof, aofTemplate, writes[writeIndex++ % writes.length]!, false);
    }
    fsync?.style.setProperty("--v", (clock % 1).toFixed(3));
  });

  return () => {
    loop.cleanup();
    log.innerHTML = initialLog;
    aof.innerHTML = initialAof;
    cells.forEach((cell, i) => (cell.className = initialCells[i]!));
  };
}
