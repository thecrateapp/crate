// TEST_GAP: layout, CSS transitions and the visible loop need a real browser;
// the replay model is covered in radio.test.ts and the figure in
// e2e/blog-radio.spec.ts.
import type { Cleanup } from "../../motion/page";
import { initPhaseLoop } from "./phase-loop";
import {
  DELIVERED_LIMIT,
  METER_SECONDS,
  RADIO_TRACKS,
  radioFrame,
  radioReadout,
  ROW_SLOTS,
  STATUS_LABEL,
  type Chip,
  type RadioScript,
  type Reading,
} from "./radio";

type Lane = "buffer" | "delivered" | "heard";
const LANES: Lane[] = ["buffer", "delivered", "heard"];
const READINGS = ["best", "band", "play", "queued"] as const;

const flag = (element: Element, name: string, on: boolean) => {
  if (on) element.setAttribute(`data-${name}`, "");
  else element.removeAttribute(`data-${name}`);
};

const setText = (node: Element | null | undefined, value: string) => {
  if (node && node.textContent !== value) node.textContent = value;
};

export function initRadio(root: HTMLElement): Cleanup {
  const scene = root.querySelector<HTMLElement>(".rr");
  const raw = scene?.dataset.rrScript;
  if (!scene || !raw) return () => {};
  const script = JSON.parse(raw) as RadioScript;
  const one = <T extends Element = HTMLElement>(selector: string) =>
    root.querySelector<T>(selector);

  const rows = new Map(
    [...root.querySelectorAll<HTMLElement>("[data-rr-row]")].map((element) => [
      element.dataset.rrRow!,
      {
        element,
        n: element.querySelector("[data-rr-n]"),
        score: element.querySelector("[data-rr-score]"),
        status: element.querySelector("[data-rr-status]"),
        pick: element.querySelector("[data-rr-pick]"),
        label: element.querySelector("[data-rr-band-label]"),
      },
    ]),
  );
  const lanes = Object.fromEntries(
    LANES.map((lane) => {
      const element = one(`[data-rr-lane="${lane}"]`);
      const chips = new Map(
        [...(element?.querySelectorAll<HTMLElement>("[data-rr-chip]") ?? [])].map(
          (chip) => [chip.dataset.rrChip!, chip],
        ),
      );
      return [lane, { element, chips }];
    }),
  ) as Record<Lane, { element: HTMLElement | null; chips: Map<string, HTMLElement> }>;
  const caseLabel = one("[data-rr-case]");
  const poolEnd = one("[data-rr-end]");
  const count = one("[data-rr-count]");
  const meter = one("[data-rr-meter]");
  const fill = one("[data-rr-fill]");
  const playText = one("[data-rr-play]");
  const readouts = Object.fromEntries(
    READINGS.map((key) => {
      const dd = one(`[data-rr-ro="${key}"]`);
      return [
        key,
        {
          dd,
          text: dd?.querySelector("[data-rr-text]"),
          note: dd?.querySelector("[data-rr-note]"),
        },
      ];
    }),
  ) as Record<
    (typeof READINGS)[number],
    { dd: HTMLElement | null; text?: Element | null; note?: Element | null }
  >;

  const renderLane = (lane: Lane, items: Chip[]) => {
    const { element, chips } = lanes[lane];
    for (const item of items) {
      const chip = chips.get(item.id);
      if (!chip) continue;
      flag(chip, "on", item.on);
      chip.dataset.tone = item.tone;
      chip.style.order = String(item.order);
    }
    if (element)
      element.dataset.count = String(items.filter((item) => item.on).length);
  };

  const renderReading = (key: (typeof READINGS)[number], value: Reading) => {
    const { dd, text, note } = readouts[key];
    if (!dd) return;
    setText(text, value.text);
    setText(note, value.note);
    if (value.tone) dd.dataset.tone = value.tone;
    else delete dd.dataset.tone;
  };

  return initPhaseLoop(root, {
    tracks: RADIO_TRACKS,
    initial: "selector",
    render: ({ time }) => {
      const frame = radioFrame(script, time);
      setText(caseLabel, frame.caseLabel);

      flag(scene, "scan", frame.scan !== null);
      scene.style.setProperty("--scan", String(frame.scan ?? 0));
      scene.dataset.band = frame.band
        ? frame.band.applied
          ? "applied"
          : "ghost"
        : "off";
      if (frame.band) {
        scene.style.setProperty("--best", String(frame.band.from));
        scene.style.setProperty("--limit", String(frame.band.to));
      }
      const picked = frame.rows.find((row) => row.pick);
      scene.dataset.pick = picked?.pickTone ?? "";
      const bandLabel = frame.band?.applied
        ? `≤ ${frame.band.to.toFixed(2)}`
        : "band not used";

      for (const row of frame.rows) {
        const view = rows.get(row.id);
        if (!view) continue;
        const { element } = view;
        flag(element, "visible", row.visible);
        flag(element, "verdict", row.verdict);
        flag(element, "best", row.best);
        element.dataset.slot = String(row.slot);
        element.dataset.status = row.status ?? "";
        element.dataset.pick = row.pick ?? "";
        element.dataset.pickTone = row.pickTone ?? "";
        element.style.setProperty("--slot", String(row.slot));
        if (row.score !== null)
          element.style.setProperty("--score", String(row.score));
        setText(view.n, String(row.slot + 1).padStart(2, "0"));
        setText(view.score, row.score === null ? "—" : row.score.toFixed(2));
        setText(view.status, row.status ? STATUS_LABEL[row.status] : "");
        setText(view.pick, row.pick ?? "");
        setText(view.label, bandLabel);
      }

      const { ranked, excluded } = frame.pool;
      if (poolEnd) {
        poolEnd.style.setProperty("--slot", String(ranked + excluded));
        flag(poolEnd, "full", ranked + excluded >= ROW_SLOTS);
        setText(
          poolEnd,
          `end of pool · ${ranked} ranked${excluded ? ` · ${excluded} excluded` : ""}`,
        );
      }

      for (const lane of LANES) renderLane(lane, frame.lanes[lane]);
      setText(
        count,
        `${frame.lanes.delivered.filter((chip) => chip.on).length} / ${DELIVERED_LIMIT}`,
      );

      const play = frame.play;
      if (meter) meter.dataset.counted = play ? String(play.counted) : "none";
      fill?.style.setProperty(
        "--fill",
        String(play ? Math.min(1, play.seconds / METER_SECONDS) : 0),
      );
      setText(
        playText,
        play
          ? `${Math.round(play.seconds)} s / ${play.threshold} s`
          : "qualifying play",
      );

      const values = radioReadout(frame);
      for (const key of READINGS) renderReading(key, values[key]);
    },
  });
}
