import { describe, expect, it } from "vitest";
import {
  CONNECT_STATES,
  CONNECT_TRACKS,
  connectFrame,
  connectReadout,
  NODES,
} from "./connect";

describe("Connect handoff scripts", () => {
  it("has one phase start per phase of copy", () => {
    for (const state of CONNECT_STATES)
      expect(CONNECT_TRACKS[state.id]!.starts).toHaveLength(
        state.phases.length,
      );
  });

  it("v1 starts the desktop before the phone is told to stop", () => {
    const beforeAck = connectFrame("v1", 4);
    expect(beforeAck.owner).toBe("phone");
    expect(beforeAck.sound).toEqual({ phone: true, desktop: true });
    expect(beforeAck.desktop).toBe("playing");
    expect(connectReadout(beforeAck).sound).toEqual({
      text: "Phone + Desktop",
      tone: "warn",
    });

    const afterAck = connectFrame("v1", 6.4);
    expect(afterAck.owner).toBe("desktop");
    expect(afterAck.sound.phone).toBe(true);

    const settled = connectFrame("v1", 9);
    expect(settled.sound).toEqual({ phone: false, desktop: true });
  });

  it("v2 reports ready while the phone still owns and plays", () => {
    const ready = connectFrame("v2", 3.6);
    expect(ready.owner).toBe("phone");
    expect(ready.desktop).toBe("applied");
    expect(ready.sound).toEqual({ phone: true, desktop: false });
    expect(ready.deadline).toBeGreaterThan(0);
    expect(connectReadout(ready).desktop.text).toBe("Queue applied");
  });

  it("v2 commits ownership before either player changes its sound", () => {
    const committed = connectFrame("v2", 5);
    expect(committed.owner).toBe("desktop");
    expect(committed.sound).toEqual({ phone: true, desktop: false });
    expect(committed.deadline).toBeNull();
    expect(committed.record).toContain("v42");

    const settled = connectFrame("v2", 8);
    expect(settled.sound).toEqual({ phone: false, desktop: true });
    expect(settled.guard).toBeGreaterThan(0);
    expect(settled.guard).toBeLessThan(1);
    expect(connectFrame("v2", 9.8).guard).toBe(1);
  });

  it("moves each message between its two nodes only during its window", () => {
    const frame = connectFrame("v2", 3.6);
    const ready = frame.packets.find(
      (packet) => packet.label === "transfer_ready",
    )!;
    expect(ready.visible).toBe(true);
    expect(ready.x).toBeLessThan(NODES.desktop.x);
    expect(ready.x).toBeGreaterThan(NODES.server.x);
    const incoming = frame.packets.find(
      (packet) => packet.label === "transfer_incoming",
    )!;
    expect(incoming.visible).toBe(false);
  });
});
