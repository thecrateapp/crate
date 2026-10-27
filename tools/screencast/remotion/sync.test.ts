import { describe, expect, it } from "vitest";
import type { CaptureEvent } from "../events";
import { localTime, syncTracks } from "./sync";

function click(t: number): CaptureEvent {
  return {
    t,
    type: "click",
    x: 0,
    y: 0,
    box: { x: 0, y: 0, width: 0, height: 0 },
  };
}

describe("syncTracks", () => {
  const desktop = { events: [click(2), click(5)], end: 8 };
  const mobile = { events: [click(3), click(4)], end: 6 };

  it("lines up matching events on a shared timeline", () => {
    const { tracks } = syncTracks([desktop, mobile]);

    expect(tracks[0].events.map((event) => event.t)).toEqual([3, 6]);
    expect(tracks[1].events.map((event) => event.t)).toEqual([3, 6]);
  });

  it("lasts until the slower device finishes", () => {
    expect(syncTracks([desktop, mobile]).duration).toBe(9);
  });

  it("holds whichever device is ahead just before its next event", () => {
    const [desktopTrack, mobileTrack] = syncTracks([desktop, mobile]).tracks;

    expect(localTime(desktopTrack.knots, 1)).toBe(1);
    expect(localTime(desktopTrack.knots, 2.5)).toBe(2);
    expect(localTime(desktopTrack.knots, 3)).toBe(2);
    expect(localTime(mobileTrack.knots, 2.5)).toBe(2.5);
    expect(localTime(mobileTrack.knots, 3.5)).toBe(3.5);
    expect(localTime(mobileTrack.knots, 5.5)).toBe(4);
  });

  it("runs in real time after the last event", () => {
    const [desktopTrack, mobileTrack] = syncTracks([desktop, mobile]).tracks;

    expect(localTime(desktopTrack.knots, 7)).toBe(6);
    expect(localTime(mobileTrack.knots, 7)).toBe(5);
  });

  it("leaves tracks untouched when their events do not match", () => {
    const result = syncTracks([desktop, { events: [click(1)], end: 4 }]);

    expect(result.duration).toBe(8);
    expect(localTime(result.tracks[1].knots, 2.5)).toBe(2.5);
    expect(result.tracks[1].events[0].t).toBe(1);
  });
});
