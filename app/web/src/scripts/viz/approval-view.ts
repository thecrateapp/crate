// TEST_GAP: ScrollTrigger needs a real layout engine; the step, gate and fill maths is covered in approval-math.test.ts and mounting in the Playwright viz specs.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";
import { scrambleText } from "../motion/scramble";
import { flowAt } from "./approval-math";

gsap.registerPlugin(ScrollTrigger);

const GATE_WEIGHT = 2;

export function initApproval(root: HTMLElement): Cleanup {
  const rail = root.querySelector<HTMLElement>(".rail");
  const steps = [...root.querySelectorAll<HTMLElement>("[data-flow-step]")];
  const status = root.querySelector<HTMLElement>("[data-flow-status]");
  const gate = steps.findIndex((step) => step.dataset.actor === "person");
  if (!rail || !status || gate < 0 || reducedMotion()) return () => {};
  const weights = steps.map((_, i) => (i === gate ? GATE_WEIGHT : 1));
  const statuses = steps.map((step) => step.dataset.status ?? "");
  const approvedText = root.dataset.approved ?? "";
  const finalStatus = status.textContent ?? "";
  let shown = "";

  const setStatus = (text: string, waiting: boolean) => {
    status.classList.toggle("is-waiting", waiting);
    scrambleText(status, text, { durationMs: 380 });
  };

  const render = (progress: number) => {
    const frame = flowAt(progress, weights, gate);
    rail.style.setProperty("--p", frame.fill.toFixed(3));
    const key = `${frame.states.join()}|${frame.approved}`;
    if (key === shown) return;
    shown = key;
    steps.forEach((step, i) => (step.dataset.state = frame.states[i]));
    root.classList.toggle("is-approved", frame.approved);
    const waiting = frame.index === gate && !frame.approved;
    if (frame.finished) setStatus(finalStatus, false);
    else if (frame.index === gate && frame.approved)
      setStatus(approvedText, false);
    else setStatus(statuses[frame.index]!, waiting);
  };

  root.classList.add("is-live");
  const trigger = ScrollTrigger.create({
    trigger: root,
    start: "top 80%",
    end: "bottom 45%",
    onUpdate: ({ progress }) => render(progress),
    onRefresh: ({ progress }) => render(progress),
  });
  render(trigger.progress);

  return () => {
    trigger.kill();
    root.classList.remove("is-live", "is-approved");
    rail.style.setProperty("--p", "1");
    steps.forEach((step) => (step.dataset.state = "done"));
    status.classList.remove("is-waiting");
    status.textContent = finalStatus;
  };
}
