import { describe, expect, it } from "vitest";

import {
  getPlaybackDeliveryProvenance,
  setPlaybackDeliveryProvenance,
} from "@/lib/playback-provenance";

describe("playback delivery provenance", () => {
  it("keeps only the policy and origin needed for aggregate QoE", () => {
    const track = {
      id: "track-1",
      globalTrackUid: "global-track-1",
      title: "Private title that must not be telemetry",
      artist: "Private artist",
    };

    setPlaybackDeliveryProvenance(track, {
      requested_policy: "data_saver",
      effective_policy: "balanced",
      content_origin: "remote",
    });

    expect(getPlaybackDeliveryProvenance(track)).toEqual({
      requestedPolicy: "data_saver",
      effectivePolicy: "balanced",
      origin: "remote",
    });
  });
});
