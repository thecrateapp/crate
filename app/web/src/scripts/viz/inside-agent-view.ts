// TEST_GAP: ScrollTrigger and element geometry need a real browser; the step, gate and plan maths is covered in approval-math.test.ts and inside-math.test.ts, and the view is checked in the Playwright viz specs.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";
import { scrambleText } from "../motion/scramble";
import { APPROVE_AT, flowAt } from "./approval-math";
import { gateStage, type GateStage } from "./inside-math";
import { observeSize } from "./loop";

gsap.registerPlugin(ScrollTrigger);

const GATE_WEIGHT = 2.4;

export function initInsideAgent(root: HTMLElement): Cleanup {
  const rail = root.querySelector<HTMLElement>(".ag-rail");
  const steps = [...root.querySelectorAll<HTMLElement>("[data-ag-step]")];
  const status = root.querySelector<HTMLElement>("[data-ag-status]");
  const cursor = root.querySelector<HTMLElement>("[data-ag-cursor]");
  const check = root.querySelector<HTMLElement>("[data-ag-check]");
  const approve = root.querySelector<HTMLElement>("[data-ag-approve]");
  const items = [...root.querySelectorAll<HTMLElement>("[data-at]")].map(
    (node) => ({ node, at: Number(node.dataset.at) }),
  );
  const gate = Number(root.dataset.gate);
  if (!rail || !status || !cursor || !check || !approve || reducedMotion())
    return () => {};

  const weights = steps.map((_, i) => (i === gate ? GATE_WEIGHT : 1));
  const statuses = steps.map((step) => step.dataset.status ?? "");
  const approvedText = root.dataset.approved ?? "";
  const finalStatus = status.textContent ?? "";
  const finalStage = root.dataset.stage ?? "pressed";
  let spots = { rest: [0, 0], check: [0, 0], approve: [0, 0] };
  let shownStatus = "";
  let shownStates = "";
  let stage: GateStage | "" = "";

  const centre = (element: HTMLElement) => {
    let x = element.offsetWidth / 2;
    let y = element.offsetHeight / 2;
    let node: HTMLElement | null = element;
    while (node && node !== root) {
      x += node.offsetLeft;
      y += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }
    return [x - 2, y - 2];
  };

  const place = (spot: number[]) =>
    cursor.style.setProperty(
      "transform",
      `translate(${spot[0]!.toFixed(0)}px, ${spot[1]!.toFixed(0)}px)`,
    );

  const moveCursor = (next: GateStage) => {
    cursor.classList.toggle("is-on", next === "review" || next === "checked");
    if (next === "idle") place(spots.rest);
    else if (next === "review") place(spots.check);
    else place(spots.approve);
  };

  const setStatus = (text: string, waiting: boolean) => {
    if (text === shownStatus) return;
    shownStatus = text;
    status.classList.toggle("is-waiting", waiting);
    scrambleText(status, text, { durationMs: 380 });
  };

  const render = (progress: number) => {
    const frame = flowAt(progress, weights, gate);
    const beat = frame.finished ? steps.length : frame.index + frame.local;
    rail.style.setProperty("--p", frame.fill.toFixed(3));
    items.forEach(({ node, at }) =>
      node.classList.toggle("is-shown", beat >= at),
    );
    const states = frame.states.join();
    if (states !== shownStates) {
      shownStates = states;
      steps.forEach((step, i) => (step.dataset.state = frame.states[i]));
    }
    const next = gateStage(frame.index, gate, frame.local, APPROVE_AT);
    if (next !== stage) {
      if (next === "pressed" && stage === "checked") {
        approve.classList.add("is-tap");
        window.setTimeout(() => approve.classList.remove("is-tap"), 180);
      }
      stage = next;
      root.dataset.stage = next;
      moveCursor(next);
    }
    if (frame.finished) setStatus(finalStatus, false);
    else if (frame.index === gate && frame.approved)
      setStatus(approvedText, false);
    else setStatus(statuses[frame.index]!, frame.index === gate);
  };

  const stopResize = observeSize(root, (width, height) => {
    spots = {
      rest: [width * 0.82, height + 12],
      check: centre(check),
      approve: centre(approve),
    };
    if (stage) moveCursor(stage);
  });

  root.classList.add("is-live");
  const trigger = ScrollTrigger.create({
    trigger: root,
    start: "top 85%",
    end: "bottom 35%",
    onUpdate: ({ progress }) => render(progress),
    onRefresh: ({ progress }) => render(progress),
  });
  render(trigger.progress);

  return () => {
    stopResize();
    trigger.kill();
    root.classList.remove("is-live");
    root.dataset.stage = finalStage;
    rail.style.setProperty("--p", "1");
    steps.forEach((step) => (step.dataset.state = "done"));
    items.forEach(({ node }) => node.classList.remove("is-shown"));
    status.classList.remove("is-waiting");
    status.textContent = finalStatus;
  };
}
