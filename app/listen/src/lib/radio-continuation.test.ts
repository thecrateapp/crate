import { beforeEach, expect, it, vi } from "vitest";
import type { PlaySource } from "@/contexts/player-types";
vi.mock("@/lib/api", () => ({
  api: vi.fn(),
  resolveMaybeApiAssetUrl: (url: string) => url,
}));
import { api } from "@/lib/api";
import {
  acknowledgeContinuationBatch,
  ensureContinuationSession,
  fetchContinuationBatch,
} from "./radio-continuation";
beforeEach(() => vi.clearAllMocks());
it("retries a lost first batch with the same session then advances only on acknowledgement", async () => {
  const source: PlaySource = {
    type: "album",
    name: "Album",
    radio: { seedType: "album", seedId: 42 },
  };
  const signal = new AbortController().signal;
  vi.mocked(api).mockRejectedValueOnce(new Error("lost response"));
  await expect(fetchContinuationBatch(source, [], signal)).rejects.toThrow(
    "lost response",
  );
  const id = ensureContinuationSession(source);
  vi.mocked(api).mockResolvedValueOnce({
    tracks: [],
    status: "retryable_empty",
    batch_index: 0,
    revision: 1,
  });
  const batch = await fetchContinuationBatch(source, [], signal);
  expect(vi.mocked(api).mock.calls[0]![2]).toMatchObject({
    session_id: id,
    seed_type: "album",
    seed_value: "42",
  });
  expect(vi.mocked(api).mock.calls[1]![2]).toEqual(
    vi.mocked(api).mock.calls[0]![2],
  );
  acknowledgeContinuationBatch(source, batch);
  vi.mocked(api).mockResolvedValueOnce({
    tracks: [],
    status: "retryable_empty",
    batch_index: 1,
    revision: 1,
  });
  await fetchContinuationBatch(source, [], signal);
  expect(api).toHaveBeenLastCalledWith(
    "/api/radio/next",
    "POST",
    expect.objectContaining({ session_id: id, batch_index: 1, revision: 1 }),
    { signal },
  );
});
it("joins an existing shaped radio at batch one and uses the buffer tail", async () => {
  const source: PlaySource = {
    type: "radio",
    name: "Radio",
    radio: { seedType: "discovery", shapedSessionId: "s" },
  };
  vi.mocked(api).mockResolvedValue({
    tracks: [],
    status: "retryable_empty",
    batch_index: 1,
    revision: 1,
  });
  await fetchContinuationBatch(
    source,
    [
      { id: "playing", title: "Playing", artist: "A" },
      { id: "tail", entityUid: "tail-uid", title: "Tail", artist: "B" },
    ],
    new AbortController().signal,
  );
  expect(api).toHaveBeenCalledWith(
    "/api/radio/next",
    "POST",
    expect.objectContaining({
      session_id: "s",
      batch_index: 1,
      buffer_refs: ["playing", "tail-uid"],
    }),
    expect.anything(),
  );
});
it("uses the shaped home-playlist seed, retaining source intent", async () => {
  const source: PlaySource = {
    type: "playlist",
    name: "Daily",
    radio: { seedType: "playlist", seedId: "daily" },
  };
  vi.mocked(api).mockResolvedValue({
    tracks: [],
    status: "retryable_empty",
    batch_index: 0,
    revision: 1,
  });
  await fetchContinuationBatch(source, [], new AbortController().signal);
  expect(api).toHaveBeenCalledWith(
    "/api/radio/start",
    "POST",
    expect.objectContaining({
      seed_type: "home-playlist",
      seed_value: "daily",
    }),
    expect.anything(),
  );
  expect(source.type).toBe("playlist");
});
it("creates a valid UUID for HTTP LAN environments without randomUUID", () => {
  const original = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
  Object.defineProperty(crypto, "randomUUID", {
    configurable: true,
    value: undefined,
  });
  try {
    const source: PlaySource = {
      type: "album",
      name: "A",
      radio: { seedType: "album", seedId: 1 },
    };
    expect(ensureContinuationSession(source)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  } finally {
    if (original) Object.defineProperty(crypto, "randomUUID", original);
    else delete (crypto as { randomUUID?: Crypto["randomUUID"] }).randomUUID;
  }
});
