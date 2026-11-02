import { describe, expect, it, vi } from "vitest";

import {
  createPlaybackQoeStore,
  PLAYBACK_QOE_LIMITS,
  type PlaybackQoeSendResult,
} from "@/lib/playback-qoe-store";

interface Event {
  event: string;
}

interface Sent {
  schema_version: number;
  batch_id: string;
  delivery?: { dropped: number; expired: number; send_failed: number };
  events: Array<Event & { event_id: string }>;
}

function harness(responses: Array<PlaybackQoeSendResult | Error> = []) {
  let now = 1_000_000;
  let id = 0;
  let scope = "https://a.example|server-a";
  const timers: Array<{ at: number; callback: () => void } | null> = [];
  const sent: Sent[] = [];
  const send = vi.fn(async (body: string) => {
    sent.push(JSON.parse(body) as Sent);
    const response = responses.shift() ?? { status: 204 };
    if (response instanceof Error) throw response;
    return response;
  });
  const store = createPlaybackQoeStore<Event>({
    now: () => now,
    createId: () => `id-${String(++id).padStart(8, "0")}`,
    getScope: () => scope,
    send,
    setTimer: (callback, delayMs) => {
      timers.push({ at: now + delayMs, callback });
      return timers.length - 1;
    },
    clearTimer: (timer) => {
      timers[timer as number] = null;
    },
  });

  async function advance(ms: number) {
    const until = now + ms;
    for (;;) {
      const due = timers
        .map((timer, index) => ({ timer, index }))
        .filter(({ timer }) => timer && timer.at <= until)
        .sort((a, b) => a.timer!.at - b.timer!.at)[0];
      if (!due) break;
      now = Math.max(now, due.timer!.at);
      timers[due.index] = null;
      due.timer!.callback();
      for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
    }
    now = until;
  }

  return {
    store,
    sent,
    send,
    advance,
    setScope: (value: string) => {
      scope = value;
    },
    events: () => sent.flatMap((batch) => batch.events),
  };
}

function nth<T>(items: T[], index: number): T {
  const item = items[index < 0 ? items.length + index : index];
  if (item === undefined) throw new Error(`missing item ${index}`);
  return item;
}

function record(store: ReturnType<typeof harness>["store"], count: number) {
  for (let index = 0; index < count; index += 1) {
    store.record({ event: "stall_start" });
  }
}

describe("playback QoE store", () => {
  it("keeps observing past 24 events when they arrive over several windows", async () => {
    const { store, advance, events } = harness();

    for (let window = 0; window < 4; window += 1) {
      record(store, 10);
      await advance(60_000);
    }

    expect(events()).toHaveLength(40);
    expect(store.snapshot().delivery.dropped).toBe(0);
  });

  it("bounds a flood and reports the discarded events with the next batch", async () => {
    const { store, advance, events, sent } = harness();

    record(store, 100);
    await advance(5_000);
    record(store, 1);
    await advance(5_000);

    expect(events().length).toBe(PLAYBACK_QOE_LIMITS.burst + 1);
    expect(nth(sent, 0).delivery?.dropped).toBe(100 - PLAYBACK_QOE_LIMITS.burst);
    expect(sent.slice(1).every((batch) => !batch.delivery)).toBe(true);
    expect(store.snapshot().delivery.dropped).toBe(0);
  });

  it("gives every event and batch an identifier and sends schema version 2", async () => {
    const { store, advance, sent } = harness();

    record(store, 2);
    await advance(1_000);

    expect(sent).toHaveLength(1);
    expect(nth(sent, 0).schema_version).toBe(2);
    expect(nth(sent, 0).batch_id).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(new Set(nth(sent, 0).events.map((event) => event.event_id)).size).toBe(2);
    expect(nth(sent, 0).delivery).toBeUndefined();
  });

  it("retries a failed batch with the same identifiers, then gives up and counts it", async () => {
    const { store, advance, sent } = harness([
      new Error("offline"),
      { status: 503 },
      { status: 0 },
    ]);

    record(store, 3);
    await advance(1_000);
    await advance(2_000);
    await advance(8_000);
    await advance(60_000);

    expect(sent).toHaveLength(3);
    expect(new Set(sent.map((batch) => batch.batch_id)).size).toBe(1);
    expect(nth(sent, 1).events).toEqual(nth(sent, 0).events);
    expect(store.snapshot()).toMatchObject({
      buffered: 0,
      delivery: { send_failed: 3 },
    });

    record(store, 1);
    await advance(1_000);
    expect(nth(sent, -1).delivery).toEqual({
      dropped: 0,
      expired: 0,
      send_failed: 3,
    });
  });

  it("expires events that wait longer than their time to live", async () => {
    const { store, advance, sent } = harness([
      { status: 429, retryAfterSeconds: 900 },
    ]);

    record(store, 2);
    await advance(1_000);
    record(store, 1);
    await advance(900_000);

    expect(sent).toHaveLength(1);
    expect(store.snapshot()).toMatchObject({
      buffered: 0,
      delivery: { expired: 3 },
    });
  });

  it("caps what it holds while the server is unreachable", async () => {
    const { store, advance } = harness([
      { status: 429, retryAfterSeconds: 3_600 },
    ]);

    for (let minute = 0; minute < 8; minute += 1) {
      record(store, 30);
      await advance(60_000);
    }

    expect(store.snapshot().buffered).toBeLessThanOrEqual(
      PLAYBACK_QOE_LIMITS.bufferSize,
    );
    expect(store.snapshot().delivery.dropped).toBeGreaterThan(0);
  });

  it("waits for Retry-After on 429 and resends the same batch", async () => {
    const { store, advance, sent } = harness([
      { status: 429, retryAfterSeconds: 30 },
    ]);

    record(store, 2);
    await advance(1_000);
    await advance(29_000);
    expect(sent).toHaveLength(1);

    await advance(1_000);
    expect(sent).toHaveLength(2);
    expect(nth(sent, 1).batch_id).toBe(nth(sent, 0).batch_id);
    expect(store.snapshot().buffered).toBe(0);
  });

  it("drops a rejected batch on 401 and pauses instead of retrying", async () => {
    const { store, advance, sent } = harness([{ status: 401 }]);

    record(store, 2);
    await advance(1_000);
    record(store, 1);
    await advance(30_000);

    expect(sent).toHaveLength(1);
    expect(store.snapshot().delivery.send_failed).toBe(2);

    await advance(31_000);
    expect(sent).toHaveLength(2);
    expect(nth(sent, 1).delivery?.send_failed).toBe(2);
  });

  it("forgets everything from another server or account", async () => {
    const { store, advance, sent, setScope } = harness([{ status: 503 }]);

    record(store, 3);
    await advance(1_000);
    setScope("https://b.example|server-b");
    record(store, 1);
    await advance(10_000);

    expect(sent).toHaveLength(2);
    expect(nth(sent, 1).events).toHaveLength(1);
    expect(nth(sent, 1).delivery).toBeUndefined();
  });

  it("clears pending events and ignores a request that was in flight", async () => {
    let resolve: (value: PlaybackQoeSendResult) => void = () => {};
    const { store, advance, send } = harness();
    send.mockImplementationOnce(
      () =>
        new Promise<PlaybackQoeSendResult>((done) => {
          resolve = done;
        }),
    );

    record(store, 2);
    await advance(1_000);
    record(store, 2);
    store.clear();
    resolve({ status: 503 });
    await advance(60_000);

    expect(send).toHaveBeenCalledTimes(1);
    expect(store.snapshot()).toEqual({
      buffered: 0,
      delivery: { dropped: 0, expired: 0, send_failed: 0 },
      pausedUntil: 0,
    });
  });

  it("stops scheduling once the buffer is empty", async () => {
    const { store, advance, send } = harness();

    record(store, 1);
    await advance(10 * 60_000);

    expect(send).toHaveBeenCalledTimes(1);
  });
});
