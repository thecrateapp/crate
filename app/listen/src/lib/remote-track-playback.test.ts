import { describe, expect, it, vi } from "vitest";

const { apiMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
}));

import { resolveRemotePlayableTrack } from "@/lib/remote-track-playback";

describe("remote track playback resolution", () => {
  it("reuses a fresh remote stream ticket for cloned track objects", async () => {
    apiMock.mockResolvedValueOnce({
      stream_url: "/api/federation/remote/streams/ticket-1",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      playback_session: "signed-playback-session",
      content_origin: "remote",
    });

    const baseTrack = {
      id: "global-track-1",
      globalTrackUid: "global-track-1",
      origin: "remote" as const,
      remote: {
        nodeUid: "node-b",
        nodeName: "Node B",
        remoteEntityUid: "remote-track-1",
        availability: { catalog: true, stream: true, import: false },
      },
      title: "Remote Song",
      artist: "Remote Band",
    };

    const first = await resolveRemotePlayableTrack({ ...baseTrack });
    const second = await resolveRemotePlayableTrack({ ...baseTrack });

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(first.remote?.streamUrl).toBe(
      "/api/federation/remote/streams/ticket-1",
    );
    expect(second.remote?.streamUrl).toBe(
      "/api/federation/remote/streams/ticket-1",
    );
    expect(first.remote?.playbackSession).toBe("signed-playback-session");
    expect(second.remote?.playbackSession).toBe("signed-playback-session");
  });
});
