import { describe, expect, it } from "vitest";

import { normalizeTaskEvent } from "./use-task-events";

describe("normalizeTaskEvent", () => {
  it("uses the SSE event name when the payload has no type", () => {
    const event = normalizeTaskEvent(
      {
        id: 42,
        timestamp: "2026-05-21T10:00:00Z",
        message: "Repair complete",
      },
      "step_done",
    );

    expect(event).toEqual({
      id: 42,
      type: "step_done",
      timestamp: "2026-05-21T10:00:00Z",
      data: { message: "Repair complete" },
    });
  });

  it("keeps structured data and falls back safely for malformed payloads", () => {
    expect(
      normalizeTaskEvent(
        {
          type: "item",
          data: { action: "delete_track", target: "01.flac" },
        },
        "info",
      ),
    ).toMatchObject({
      id: 0,
      type: "item",
      data: { action: "delete_track", target: "01.flac" },
    });

    expect(normalizeTaskEvent(null, "warning")).toMatchObject({
      id: 0,
      type: "warning",
      data: {},
    });
  });
});
