import { afterEach, describe, expect, it, vi } from "vitest";

import { buildCastTicketRequest, resolveCastMedia } from "./cast-sender-media";

describe("cast sender media", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("prefers the stable library entity reference for ticket requests", () => {
    expect(
      buildCastTicketRequest({
        id: "track",
        entityUid: "track-entity",
        title: "Track",
        artist: "Artist",
      }),
    ).toMatchObject({
      purpose: "google_cast",
      track_entity_uid: "track-entity",
      delivery: "auto",
    });
  });

  it("describes an unreachable Cast endpoint instead of leaking a fetch error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new TypeError("Failed to fetch"),
    );

    await expect(
      resolveCastMedia({
        stream_url: "https://stream.example/track",
        metadata_url: "https://stream.example/metadata",
        expires_at: "2030-01-01T00:00:00Z",
        delivery_policy: "direct",
      }),
    ).rejects.toThrow(
      "Could not reach the Cast media endpoint. Check that this Crate server is reachable over HTTPS.",
    );
  });

  it("retries while receiver-safe media is still preparing", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(null, { status: 425, headers: { "Retry-After": "0" } }),
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 425, headers: { "Retry-After": "0" } }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            stream_url: "https://stream.example/track",
            title: "Track",
            artist: "Artist",
          }),
          { status: 200 },
        ),
      );

    const mediaPromise = resolveCastMedia({
      stream_url: "https://stream.example/track",
      metadata_url: "https://stream.example/metadata",
      expires_at: "2030-01-01T00:00:00Z",
      delivery_policy: "auto",
    });
    await vi.runAllTimersAsync();

    await expect(mediaPromise).resolves.toMatchObject({ title: "Track" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
