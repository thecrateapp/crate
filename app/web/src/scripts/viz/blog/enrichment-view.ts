// TEST_GAP: SVG layout and the visible loop need a real browser; the cache,
// pool, assembly and write rules are covered in enrichment.test.ts and the
// figure in e2e/blog-enrichment.spec.ts.
import type { Cleanup } from "../../motion/page";
import {
  ENRICHMENT_TRACKS,
  enrichmentFrame,
  enrichmentReadout,
  polar,
  RING_R,
  type EnrichmentFrame,
} from "./enrichment";
import { initPhaseLoop } from "./phase-loop";

export function initEnrichment(root: HTMLElement): Cleanup {
  const scene = root.querySelector<HTMLElement>(".en");
  if (!scene) return () => {};
  const all = <T extends Element>(selector: string) => [
    ...root.querySelectorAll<T>(selector),
  ];
  const one = (selector: string) => root.querySelector<HTMLElement>(selector);

  const sources = all<SVGGElement>("[data-en-src]");
  const links = all<SVGGElement>("[data-en-link]");
  const dots = all<SVGCircleElement>("[data-en-dot]");
  const packets = all<SVGCircleElement>("[data-en-packet]");
  const notes = all<HTMLElement>("[data-en-note]");
  const steps = all<HTMLElement>("[data-en-step]");
  const jobs = all<HTMLElement>("[data-en-job]");
  const fields = all<HTMLElement>("[data-en-field]").map((element) => ({
    element,
    id: element.dataset.enField!,
    value: element.querySelector<HTMLElement>("[data-en-value]"),
    note: element.querySelector<HTMLElement>("[data-en-fnote]"),
    outcome: element.querySelector<HTMLElement>("[data-en-outcome]"),
  }));
  const head = one("[data-en-head]");
  const rowState = one("[data-en-rowstate]");
  const chip = one("[data-en-chip]");
  const stamp = one("[data-en-stamp]");
  const busy = one("[data-en-busy]");
  const readout = {
    hits: one('[data-en-ro="hits"]'),
    payloads: one('[data-en-ro="payloads"]'),
    row: one('[data-en-ro="row"]'),
    bio: one('[data-en-ro="bio"]'),
  };

  const setText = (node: HTMLElement | null, value: string, tone?: string) => {
    if (!node) return;
    if (node.textContent !== value) node.textContent = value;
    if (tone) node.dataset.tone = tone;
    else delete node.dataset.tone;
  };
  const byId = <T extends { id: string }>(list: T[], id: string | undefined) =>
    list.find((item) => item.id === id);

  const render = (frame: EnrichmentFrame) => {
    scene.dataset.row = frame.row;

    for (const element of sources) {
      const source = byId(frame.sources, element.dataset.enSrc);
      if (!source) continue;
      element.dataset.status = source.status;
      element.dataset.expired = String(source.expired);
      element
        .querySelector<SVGCircleElement>(".ttl")
        ?.style.setProperty(
          "stroke-dashoffset",
          (1 - source.ttlUsed).toFixed(3),
        );
    }
    for (const element of links) {
      const source = byId(frame.sources, element.dataset.enLink);
      if (!source) continue;
      element.dataset.status = source.status;
      element
        .querySelector<SVGLineElement>(".fill")
        ?.style.setProperty("stroke-dashoffset", (1 - source.link).toFixed(3));
    }
    for (const element of packets) {
      const source = byId(frame.sources, element.dataset.enPacket);
      const packet = source?.packet ?? null;
      element.style.opacity = packet ? "1" : "0";
      if (packet) {
        element.setAttribute("cx", packet.x.toFixed(1));
        element.setAttribute("cy", packet.y.toFixed(1));
      }
    }
    for (const element of dots) {
      const source = byId(frame.sources, element.dataset.enDot);
      if (!source) continue;
      const shown = source.parked && source.flow < 1;
      element.style.opacity = shown ? "1" : "0";
      const at = polar(source.id, RING_R * (1 - source.flow));
      element.setAttribute("cx", at.x.toFixed(1));
      element.setAttribute("cy", at.y.toFixed(1));
    }
    for (const element of notes) {
      const source = byId(frame.sources, element.dataset.enNote);
      if (source) setText(element, source.note);
    }

    for (const element of steps) {
      const step = byId(frame.steps, element.dataset.enStep);
      if (step)
        element.style.setProperty("--fill", `${(step.fill * 100).toFixed(1)}%`);
    }
    for (const element of jobs) {
      const job = frame.jobs.find(
        (item) => item.source === element.dataset.enJob,
      );
      if (!job) continue;
      element.dataset.status = job.status;
      element.style.setProperty("--fill", `${(job.fill * 100).toFixed(1)}%`);
    }
    head?.style.setProperty("left", `${(frame.head * 100).toFixed(2)}%`);

    for (const { element, id, value, note, outcome } of fields) {
      const field = byId(frame.fields, id);
      if (!field) continue;
      element.dataset.stage = field.stage;
      element.dataset.outcome = field.outcome ?? "";
      setText(value, field.value);
      setText(note, field.note);
      setText(
        outcome,
        field.outcome ?? (field.stage === "proposed" ? "proposed" : ""),
      );
    }

    setText(rowState, frame.row);
    setText(chip, frame.row);
    setText(stamp, frame.stamp);
    setText(busy, `${frame.busy} busy`);

    const values = enrichmentReadout(frame);
    setText(readout.hits, values.hits.text, values.hits.tone);
    setText(readout.payloads, values.payloads.text, values.payloads.tone);
    setText(readout.row, values.row.text, values.row.tone);
    setText(readout.bio, values.bio.text, values.bio.tone);
  };

  return initPhaseLoop(root, {
    tracks: ENRICHMENT_TRACKS,
    initial: "run",
    render: ({ time }) => render(enrichmentFrame(time)),
  });
}
