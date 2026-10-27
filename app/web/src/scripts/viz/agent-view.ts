// TEST_GAP: ScrollTrigger and sticky layout need a real browser; the message, beat and button maths is covered in agent-math.test.ts and mounting in the Playwright viz specs.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";
import { scrambleText } from "../motion/scramble";
import { chatAt, isPressed } from "./agent-math";

gsap.registerPlugin(ScrollTrigger);

const WAITING_BEAT = 3;

export function initAgent(root: HTMLElement): Cleanup {
  const scroller = root.querySelector<HTMLElement>(".chat-scroll");
  const pin = root.querySelector<HTMLElement>(".chat-pin");
  const status = root.querySelector<HTMLElement>("[data-chat-status]");
  const entries = [...root.querySelectorAll<HTMLElement>("[data-entry]")];
  const keys = [...root.querySelectorAll<HTMLElement>("[data-pressed-at]")];
  const beats = [...root.querySelectorAll<HTMLElement>("[data-beat-step]")];
  if (!scroller || !pin || !status || !entries.length || reducedMotion())
    return () => {};
  const entryBeats = entries.map((entry) => Number(entry.dataset.beat));
  const finalStatus = status.textContent ?? "";
  let shown = -1;
  let finished = false;
  let text = finalStatus;

  const render = (progress: number) => {
    const frame = chatAt(progress, entryBeats);
    if (frame.shown === shown && frame.finished === finished) return;
    shown = frame.shown;
    finished = frame.finished;
    entries.forEach(
      (entry, i) =>
        (entry.dataset.state = i < frame.shown ? "shown" : "hidden"),
    );
    keys.forEach((key) =>
      key.classList.toggle(
        "is-pressed",
        isPressed(Number(key.dataset.pressedAt), frame.shown),
      ),
    );
    beats.forEach(
      (beat, i) =>
        (beat.dataset.state =
          i < frame.beat ? "done" : i === frame.beat ? "active" : "pending"),
    );
    const next = entries[frame.shown];
    root.classList.toggle("is-typing", next?.dataset.from === "bot");
    const waiting = frame.beat === WAITING_BEAT && !frame.finished;
    status.classList.toggle("is-waiting", waiting);
    const nextText = frame.finished
      ? finalStatus
      : beats[frame.beat]?.dataset.status ?? "";
    if (nextText === text) return;
    text = nextText;
    scrambleText(status, text, { durationMs: 380 });
  };

  root.classList.add("is-live");
  const pinTop = () => parseFloat(getComputedStyle(pin).top) || 0;
  const trigger = ScrollTrigger.create({
    trigger: scroller,
    start: () => `top ${pinTop()}px`,
    end: () => `bottom ${pinTop() + pin.offsetHeight}px`,
    invalidateOnRefresh: true,
    onUpdate: ({ progress }) => render(progress),
    onRefresh: ({ progress }) => render(progress),
  });
  render(trigger.progress);

  return () => {
    trigger.kill();
    root.classList.remove("is-live", "is-typing");
    entries.forEach((entry) => delete entry.dataset.state);
    keys.forEach((key) => key.classList.add("is-pressed"));
    beats.forEach((beat) => (beat.dataset.state = "done"));
    status.classList.remove("is-waiting");
    status.textContent = finalStatus;
  };
}
