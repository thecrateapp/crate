import { describe, expect, it } from "vitest";
import fixture from "../../../../../tests/admin-e2e/fixtures/dashboard-snapshot.json";
import type { OpsSnapshotData } from "@/contexts/OpsSnapshotContext";
import { getDashboardModel } from "./dashboard-model";
const now = Date.parse("2026-10-18T10:00:00Z");
function data() {
  const snapshot = structuredClone(fixture);
  snapshot.snapshot.built_at = "2026-10-18T09:59:45Z";
  snapshot.snapshot.stale_after = "2026-10-18T10:00:45Z";
  return snapshot as unknown as OpsSnapshotData;
}
describe("Dashboard interpretation of existing reports", () => {
  it("describes measured services without claiming workers or playback health", () => {
    const model = getDashboardModel(data(), null, now);
    expect(model.freshness).toBe("current");
    expect(model.headline).toBe("Reported services responding");
    expect(model.signals.map((signal) => signal.state)).toEqual([
      "online",
      "online",
      "online",
    ]);
    expect(model.attention).toEqual([]);
  });
  it.each(["flag", "expiry", "error", "missing", "invalid", "future"])(
    "does not report current health from %s metadata",
    (kind) => {
      const input = data();
      let error: null | string = null;
      if (kind === "flag") input.snapshot.stale = true;
      if (kind === "expiry")
        input.snapshot.stale_after = "2026-10-18T09:59:59Z";
      if (kind === "error") error = "offline";
      if (kind === "missing") input.snapshot.built_at = null;
      if (kind === "invalid") input.snapshot.stale_after = "invalid";
      if (kind === "future") input.snapshot.built_at = "2026-10-18T10:01:00Z";
      input.live.systems.postgres = false;
      const model = getDashboardModel(input, error, now);
      expect(model.freshness).not.toBe("current");
      expect(model.attention).toEqual([]);
      expect(model.headline).not.toBe("Service interruption reported");
    },
  );
  it("distinguishes an explicit current interruption from missing signals", () => {
    const input = data();
    input.live.systems.postgres = false;
    expect(
      getDashboardModel(input, null, now).attention.map((item) => item.id),
    ).toEqual(["postgres"]);
    expect(getDashboardModel(input, null, now).headline).toBe(
      "Service interruption reported",
    );
    delete (input.live.systems as Partial<typeof input.live.systems>).postgres;
    const unknown = getDashboardModel(input, null, now);
    expect(unknown.signals[0]!.state).toBe("unknown");
    expect(unknown.attention).toEqual([]);
    expect(unknown.headline).toBe("Some service signals unavailable");
  });
  it.each([true, false])(
    "reads domain-event Redis independently from cache Redis (%s)",
    (connected) => {
      const input = data();
      input.eventing.redis_connected = !connected;
      input.eventing.domain_events.redis_connected = connected;
      const model = getDashboardModel(input, null, now);
      expect(model.signals[2]!.state).toBe(connected ? "online" : "offline");
      expect(model.attention.map((signal) => signal.id)).toEqual(
        connected ? [] : ["redis"],
      );
    },
  );
  it("does not substitute cache Redis when the domain-event report is missing", () => {
    const input = data();
    delete (input.eventing as Partial<typeof input.eventing>).domain_events;
    const model = getDashboardModel(input, null, now);
    expect(model.signals[2]!.state).toBe("unknown");
    expect(model.attention).toEqual([]);
  });
  it.each(["stale", "unavailable", "absent", "current"])(
    "respects %s analysis metadata inside a fresh outer report",
    (kind) => {
      const input = data();
      Object.assign(
        input.analysis,
        kind === "absent"
          ? {}
          : {
              stale: kind !== "current",
              unavailable: kind === "unavailable",
            },
      );
      const model = getDashboardModel(input, null, now);
      expect(model.freshness).toBe("current");
      expect(model.analysisFreshness).toBe(
        kind === "absent" ? "unknown" : kind,
      );
      expect(model.analysisReported).toBe(kind !== "unavailable");
      expect(model.daemons.length).toBe(kind === "unavailable" ? 0 : 2);
    },
  );
  it("sums all five real queues without treating saturation or admission waits as incidents", () => {
    const input = data();
    input.live.queue_breakdown.running = {
      fast: 1,
      default: 2,
      heavy: 3,
      maintenance: 4,
      playback: 5,
    };
    input.live.queue_breakdown.pending = {
      fast: 5,
      default: 4,
      heavy: 3,
      maintenance: 2,
      playback: 1,
    };
    input.live.worker_slots = { active: 6, max: 6 };
    input.live.db_heavy_gate = { active: 1, pending: 3, blocking: true };
    const model = getDashboardModel(input, null, now);
    expect(model.running).toBe(15);
    expect(model.waiting).toBe(15);
    expect(model.attention).toEqual([]);
    delete (
      input.live.queue_breakdown.pending as Partial<
        typeof input.live.queue_breakdown.pending
      >
    ).maintenance;
    expect(getDashboardModel(input, null, now).waiting).toBeNull();
    input.live.queue_breakdown.running.fast = -1;
    expect(getDashboardModel(input, null, now).running).toBeNull();
  });
  it("does not infer global inactivity from an empty task list while daemons report activity", () => {
    const input = data();
    input.live.running_tasks = [];
    input.analysis.analysis_active = 2;
    input.analysis.bliss_active = 3;
    const model = getDashboardModel(input, null, now);
    expect(model.work).toEqual([]);
    expect(model.daemons).toEqual([
      { label: "Audio analysis", active: 2 },
      { label: "Bliss analysis", active: 3 },
    ]);
  });
  it("normalizes real structured progress and keeps the task identity", () => {
    const input = data();
    input.live.running_tasks[0]!.progress = JSON.stringify({
      done: 3,
      total: 12,
      phase: "processing",
      item: "Costa Norte",
    });
    const task = getDashboardModel(input, null, now).work[0]!;
    expect(task.id).toBe("sample-running");
    expect(task.percent).toBe(25);
    expect(task.quantity).toBe("3 / 12");
    expect(task.detail).toBe("processing · Costa Norte");
  });
  it.each([
    "{broken",
    JSON.stringify({ percent: 150 }),
    JSON.stringify({ done: -1, total: 12 }),
    "null",
    "[1,2]",
  ])("does not invent progress from %s", (progress) => {
    const input = data();
    input.live.running_tasks[0]!.progress = progress;
    const task = getDashboardModel(input, null, now).work[0]!;
    expect(task.percent).toBeNull();
    expect(task.detail).toBe("Progress unavailable");
  });
  it("keeps plain progress text and an explicit zero percent without a total", () => {
    const input = data();
    input.live.running_tasks[0]!.progress = "Reading artwork";
    expect(getDashboardModel(input, null, now).work[0]!.detail).toBe(
      "Reading artwork",
    );
    input.live.running_tasks[0]!.progress = JSON.stringify({
      percent: 0,
      phase: "starting",
    });
    expect(getDashboardModel(input, null, now).work[0]!.percent).toBe(0);
  });
  it("chooses the latest dated completion and failure without claiming resolution or urgency", () => {
    const input = data();
    input.live.recent_tasks = [
      {
        id: "new",
        type: "sync_library",
        status: "completed",
        updated_at: "2026-10-18T09:58:00Z",
      },
      {
        id: "bad",
        type: "compute_bliss",
        status: "failed",
        updated_at: "invalid",
      },
      {
        id: "old-failure",
        type: "compute_bliss",
        status: "failed",
        updated_at: "2026-09-18T09:00:00Z",
      },
      {
        id: "future",
        type: "sync_library",
        status: "completed",
        updated_at: "2026-10-19T09:00:00Z",
      },
    ];
    const model = getDashboardModel(input, null, now);
    expect(model.lastCompleted?.id).toBe("new");
    expect(model.lastFailed?.id).toBe("old-failure");
    expect(model.attention).toEqual([]);
  });
  it("does not crash or synthesize zeros from missing sub-payloads", () => {
    const model = getDashboardModel(
      { snapshot: data().snapshot } as OpsSnapshotData,
      null,
      now,
    );
    expect(model.running).toBeNull();
    expect(model.waiting).toBeNull();
    expect(model.signals.every((signal) => signal.state === "unknown")).toBe(
      true,
    );
    expect(model.work).toEqual([]);
    expect(model.daemons).toEqual([]);
  });
});
