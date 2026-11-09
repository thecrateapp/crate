import { afterEach, describe, expect, it, vi } from "vitest";
import { initPhaseLoop, type PhaseFrame } from "./phase-loop";

const tracks = {
  before: { period: 6, starts: [0, 2, 4] },
  after: { period: 4, starts: [0, 2] },
};

function figure() {
  document.body.innerHTML = `
    <figure data-state="before">
      <button type="button" data-bf-state="before">Before</button>
      <button type="button" data-bf-state="after">After</button>
      <ol data-bf-phases="before">
        <li><button type="button" data-bf-phase="0">One</button></li>
        <li><button type="button" data-bf-phase="1">Two</button></li>
        <li><button type="button" data-bf-phase="2">Three</button></li>
      </ol>
      <ol data-bf-phases="after" hidden>
        <li><button type="button" data-bf-phase="0">One</button></li>
        <li><button type="button" data-bf-phase="1">Two</button></li>
      </ol>
    </figure>`;
  return document.querySelector<HTMLElement>("figure")!;
}

function start(root: HTMLElement, still = false) {
  let tick: (time: number, dt: number) => void = () => {};
  const cleanupLoop = vi.fn();
  const frames: PhaseFrame[] = [];
  const cleanup = initPhaseLoop(root, {
    tracks,
    initial: "before",
    still,
    render: (frame) => frames.push({ ...frame }),
    loop: (_element, frame) => {
      tick = frame;
      return { cleanup: cleanupLoop };
    },
  });
  return { tick: (dt: number) => tick(0, dt), frames, cleanup, cleanupLoop };
}

const items = (root: HTMLElement, state: string) => [
  ...root.querySelectorAll<HTMLElement>(`[data-bf-phases="${state}"] li`),
];

afterEach(() => {
  document.body.innerHTML = "";
});

describe("initPhaseLoop", () => {
  it("renders the first frame and marks the active phase while time passes", () => {
    const root = figure();
    const { tick, frames } = start(root);
    expect(root.dataset.ready).toBe("true");
    expect(frames.at(-1)?.phase).toBe(0);
    tick(2.5);
    expect(root.dataset.phase).toBe("1");
    const [first, second, third] = items(root, "before");
    expect(first?.classList.contains("is-done")).toBe(true);
    expect(second?.classList.contains("is-active")).toBe(true);
    expect(third?.classList.contains("is-active")).toBe(false);
    expect(frames.at(-1)?.time).toBeCloseTo(2.5);
  });

  it("pins a clicked phase and resumes when it is clicked again", () => {
    const root = figure();
    const { tick, frames } = start(root);
    const button = root.querySelector<HTMLButtonElement>(
      '[data-bf-phases="before"] [data-bf-phase="2"]',
    )!;
    button.click();
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(root.dataset.pinned).toBe("2");
    tick(1);
    expect(frames.at(-1)?.phase).toBe(2);
    expect(frames.at(-1)?.pinned).toBe(2);
    button.click();
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(root.dataset.pinned).toBe("");
  });

  it("switches the track, its phase list and the pressed state", () => {
    const root = figure();
    const { frames } = start(root);
    const after = root.querySelector<HTMLButtonElement>(
      '[data-bf-state="after"]',
    )!;
    after.click();
    expect(root.dataset.state).toBe("after");
    expect(after.getAttribute("aria-pressed")).toBe("true");
    expect(
      root
        .querySelector<HTMLButtonElement>('[data-bf-state="before"]')!
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      root.querySelector<HTMLElement>('[data-bf-phases="after"]')!.hidden,
    ).toBe(false);
    expect(
      root.querySelector<HTMLElement>('[data-bf-phases="before"]')!.hidden,
    ).toBe(true);
    expect(frames.at(-1)?.state).toBe("after");
  });

  it("does not start a loop when motion is reduced and shows the final phase", () => {
    const root = figure();
    const loop = vi.fn();
    const frames: PhaseFrame[] = [];
    initPhaseLoop(root, {
      tracks,
      initial: "before",
      still: true,
      render: (frame) => frames.push(frame),
      loop,
    });
    expect(loop).not.toHaveBeenCalled();
    expect(root.dataset.phase).toBe("2");
    expect(frames.at(-1)?.phase).toBe(2);
  });

  it("removes listeners and stops the loop on cleanup", () => {
    const root = figure();
    const { cleanup, cleanupLoop } = start(root);
    cleanup();
    expect(cleanupLoop).toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>('[data-bf-state="after"]')!.click();
    expect(root.dataset.state).toBe("before");
  });
});
