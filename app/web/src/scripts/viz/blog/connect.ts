import type { PhaseTrack } from "./phase-clock";

/**
 * H17 figure: a Connect handoff from a phone to a desktop, in v1 (f61a5b11) and
 * v2 (bef0448d). Message names and the 15 s, 10 s and 2.5 s limits come from
 * the code cited by the article; the timing and the version numbers are an
 * example ordering, compressed for reading.
 */

export type Device = "phone" | "desktop";
export type ConnectNode = Device | "server";
export type ConnectState = "v1" | "v2";

export const VIEW = { width: 720, height: 300 };
export const NODES: Record<ConnectNode, { x: number; y: number }> = {
  phone: { x: 112, y: 206 },
  server: { x: 360, y: 72 },
  desktop: { x: 608, y: 206 },
};

export const CONNECT_STATES = [
  {
    id: "v1",
    label: "v1",
    phases: [
      {
        title: "Request",
        body: "The server queues `transfer_in` for the desktop. The phone still owns the session.",
      },
      {
        title: "Play first",
        body: "The desktop applies the queue and starts playing. It may wait 15 s for playback without buffering.",
      },
      {
        title: "Acknowledge",
        body: "A successful acknowledgement makes the desktop the active device.",
      },
      {
        title: "Stop the phone",
        body: "Only then does `transfer_out` reach the phone. Both players were making sound in between.",
      },
    ],
  },
  {
    id: "v2",
    label: "v2",
    phases: [
      {
        title: "Pending",
        body: "The request names one desktop player. The phone keeps playing; the transfer expires after 10 s.",
      },
      {
        title: "Ready",
        body: "The desktop applies the queue without autoplay and replies `transfer_ready`. Ready is not playing.",
      },
      {
        title: "Commit",
        body: "The server checks the target and the state version, then makes the desktop the owner.",
      },
      {
        title: "Resume, pause",
        body: "`transfer_committed` resumes the desktop and `became_inactive` pauses the phone. A 2.5 s guard checks progress.",
      },
    ],
  },
] as const satisfies readonly {
  id: ConnectState;
  label: string;
  phases: readonly { title: string; body: string }[];
}[];

interface Packet {
  label: string;
  from: ConnectNode;
  to: ConnectNode;
  start: number;
  end: number;
}

interface Script {
  track: PhaseTrack;
  packets: Packet[];
  desktopQueueAt: number;
  desktopPlaysAt: number;
  ownerAt: number;
  phoneStopsAt: number;
  record: [number, string][];
  pending?: { from: number; seconds: number };
  guard?: { from: number; seconds: number };
}

const SCRIPTS: Record<ConnectState, Script> = {
  v1: {
    track: { period: 10, starts: [0, 2.4, 5, 6.6], pins: [1.2, 4.6, 5.5, 7.1] },
    packets: [
      {
        label: "transfer_in",
        from: "server",
        to: "desktop",
        start: 0.6,
        end: 1.8,
      },
      {
        label: "ack · success",
        from: "desktop",
        to: "server",
        start: 5,
        end: 6,
      },
      {
        label: "transfer_out",
        from: "server",
        to: "phone",
        start: 6.6,
        end: 7.6,
      },
    ],
    desktopQueueAt: 2.5,
    desktopPlaysAt: 3.3,
    ownerAt: 6,
    phoneStopsAt: 7.8,
    record: [
      [0, "active · phone"],
      [0.4, "transfer_in queued"],
      [6, "active · desktop"],
    ],
  },
  v2: {
    track: {
      period: 10,
      starts: [0, 2.4, 4.4, 5.8],
      pins: [1.2, 3.6, 5.2, 6.3],
    },
    packets: [
      {
        label: "transfer_incoming",
        from: "server",
        to: "desktop",
        start: 0.6,
        end: 1.8,
      },
      {
        label: "transfer_ready",
        from: "desktop",
        to: "server",
        start: 3,
        end: 4.2,
      },
      {
        label: "transfer_committed",
        from: "server",
        to: "desktop",
        start: 5.8,
        end: 6.8,
      },
      {
        label: "became_inactive",
        from: "server",
        to: "phone",
        start: 5.8,
        end: 6.8,
      },
    ],
    desktopQueueAt: 2.5,
    desktopPlaysAt: 7,
    ownerAt: 4.6,
    phoneStopsAt: 7.1,
    record: [
      [0, "v41 · active phone"],
      [0.4, "v41 · pending → desktop"],
      [4.6, "v42 · active desktop"],
    ],
    pending: { from: 0.4, seconds: 10 },
    guard: { from: 7, seconds: 2.5 },
  },
};

export const CONNECT_TRACKS: Record<ConnectState, PhaseTrack> = {
  v1: SCRIPTS.v1.track,
  v2: SCRIPTS.v2.track,
};

export interface PacketFrame {
  label: string;
  x: number;
  y: number;
  visible: boolean;
}

export interface ConnectFrame {
  owner: Device;
  sound: Record<Device, boolean>;
  desktop: "empty" | "applied" | "playing";
  record: string;
  packets: PacketFrame[];
  /** Fraction of the pending-transfer deadline left, or null without one. */
  deadline: number | null;
  /** Progress of the post-commit playback guard; 1 once it has passed. */
  guard: number | null;
}

const ease = (k: number) => {
  const t = Math.min(1, Math.max(0, k));
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};

export function connectFrame(state: ConnectState, t: number): ConnectFrame {
  const script = SCRIPTS[state];
  const owner: Device = t >= script.ownerAt ? "desktop" : "phone";
  const desktop =
    t >= script.desktopPlaysAt
      ? "playing"
      : t >= script.desktopQueueAt
        ? "applied"
        : "empty";
  const record = script.record.reduce(
    (text, [at, value]) => (t >= at ? value : text),
    "",
  );
  const packets = script.packets.map(({ label, from, to, start, end }) => {
    const a = NODES[from];
    const b = NODES[to];
    const k = ease((t - start) / (end - start));
    return {
      label,
      x: a.x + (b.x - a.x) * k,
      y: a.y + (b.y - a.y) * k,
      visible: t >= start && t < end,
    };
  });
  const pending = script.pending;
  const deadline =
    pending && t >= pending.from && t < script.ownerAt
      ? Math.max(0, 1 - (t - pending.from) / pending.seconds)
      : null;
  const guard = script.guard;
  return {
    owner,
    sound: { phone: t < script.phoneStopsAt, desktop: desktop === "playing" },
    desktop,
    record,
    packets,
    deadline,
    guard:
      guard && t >= guard.from
        ? Math.min(1, (t - guard.from) / guard.seconds)
        : null,
  };
}

type Tone = "warn" | "ok" | undefined;

export function connectReadout(frame: ConnectFrame): {
  owner: string;
  sound: { text: string; tone: Tone };
  desktop: { text: string; tone: Tone };
} {
  const { phone, desktop } = frame.sound;
  const sound =
    phone && desktop
      ? { text: "Phone + Desktop", tone: "warn" as const }
      : desktop
        ? { text: "Desktop", tone: "ok" as const }
        : phone
          ? { text: "Phone", tone: undefined }
          : { text: "Silence", tone: "warn" as const };
  const desktopState =
    frame.desktop === "playing"
      ? { text: "Playing", tone: "ok" as const }
      : frame.desktop === "applied"
        ? { text: "Queue applied", tone: undefined }
        : { text: "No queue", tone: undefined };
  return {
    owner: frame.owner === "phone" ? "Phone" : "Desktop",
    sound,
    desktop: desktopState,
  };
}
