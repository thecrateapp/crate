// TEST_GAP: SVG layout and the visible loop need a real browser; the handoff
// model is covered in connect.test.ts and the figure in e2e/blog-connect.spec.ts.
import type { Cleanup } from "../../motion/page";
import {
  CONNECT_TRACKS,
  connectFrame,
  connectReadout,
  type ConnectState,
  type Device,
} from "./connect";
import { initPhaseLoop } from "./phase-loop";

const DEVICES: Device[] = ["phone", "desktop"];

function deviceStatus(
  device: Device,
  frame: ReturnType<typeof connectFrame>,
): string {
  const owner = frame.owner === device;
  if (device === "phone")
    return frame.sound.phone
      ? owner
        ? "Playing · owner"
        : "Playing"
      : "Paused";
  if (frame.desktop === "playing") return owner ? "Playing · owner" : "Playing";
  if (frame.desktop === "applied")
    return owner ? "Owner · not playing yet" : "Queue applied · paused";
  return "No queue";
}

export function initConnect(root: HTMLElement): Cleanup {
  const scene = root.querySelector<HTMLElement>(".cn");
  if (!scene) return () => {};
  const packets = [...root.querySelectorAll<SVGGElement>("[data-cn-packet]")];
  const bars = Object.fromEntries(
    DEVICES.map((device) => [
      device,
      [
        ...root.querySelectorAll<SVGRectElement>(
          `[data-cn-bars="${device}"] rect`,
        ),
      ],
    ]),
  ) as Record<Device, SVGRectElement[]>;
  const text = (selector: string) => root.querySelector<HTMLElement>(selector);
  const record = text("[data-cn-record]");
  const status = {
    phone: text('[data-cn-status="phone"]'),
    desktop: text('[data-cn-status="desktop"]'),
  };
  const readout = {
    owner: text('[data-cn-ro="owner"]'),
    sound: text('[data-cn-ro="sound"]'),
    desktop: text('[data-cn-ro="desktop"]'),
  };
  const deadline = root.querySelector<SVGCircleElement>("[data-cn-deadline]");
  const guard = root.querySelector<SVGCircleElement>("[data-cn-guard]");

  const setText = (node: HTMLElement | null, value: string, tone?: string) => {
    if (!node) return;
    if (node.textContent !== value) node.textContent = value;
    if (tone) node.dataset.tone = tone;
    else delete node.dataset.tone;
  };

  return initPhaseLoop(root, {
    tracks: CONNECT_TRACKS,
    initial: "v2",
    render: ({ state, time, ambient }) => {
      const frame = connectFrame(state as ConnectState, time);
      const { phone, desktop } = frame.sound;
      scene.dataset.owner = frame.owner;
      scene.dataset.desktop = frame.desktop;
      scene.dataset.sound =
        phone && desktop
          ? "both"
          : phone
            ? "phone"
            : desktop
              ? "desktop"
              : "none";
      if (frame.guard === null) delete scene.dataset.guard;
      else scene.dataset.guard = frame.guard >= 1 ? "done" : "running";

      for (const element of packets) {
        const packet = frame.packets.find(
          (item) => item.label === element.dataset.cnPacket,
        );
        const visible = packet?.visible ?? false;
        element.style.opacity = visible ? "1" : "0";
        if (packet && visible)
          element.setAttribute(
            "transform",
            `translate(${packet.x.toFixed(1)} ${packet.y.toFixed(1)})`,
          );
      }

      for (const device of DEVICES) {
        const sounding = frame.sound[device];
        bars[device].forEach((bar, i) => {
          const bottom = Number(bar.dataset.bottom);
          const max = Number(bar.dataset.max);
          const level = sounding
            ? 0.3 +
              0.7 * (0.5 + 0.5 * Math.sin(ambient * (6.1 + i * 1.7) + i * 2.3))
            : 0.08;
          const height = Math.max(2, max * level);
          bar.setAttribute("y", (bottom - height).toFixed(1));
          bar.setAttribute("height", height.toFixed(1));
        });
        setText(status[device], deviceStatus(device, frame));
      }

      setText(record, frame.record);
      deadline?.style.setProperty(
        "stroke-dashoffset",
        String(frame.deadline === null ? 1 : 1 - frame.deadline),
      );
      guard?.style.setProperty(
        "stroke-dashoffset",
        String(1 - (frame.guard ?? 0)),
      );

      const values = connectReadout(frame);
      setText(readout.owner, values.owner);
      setText(readout.sound, values.sound.text, values.sound.tone);
      setText(readout.desktop, values.desktop.text, values.desktop.tone);
    },
  });
}
