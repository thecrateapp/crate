import { describe, expect, it } from "vitest";

import { trackManagementApiPath } from "./library-routes";

describe("trackManagementApiPath", () => {
  it("prefers entity uid routes when present", () => {
    expect(
      trackManagementApiPath(
        { id: 12, trackEntityUid: "0f93b8bb-5aa2-4e7a-8e04-9a36f8f2eafd" },
        "quarantine",
      ),
    ).toBe(
      "/api/manage/tracks/by-entity/0f93b8bb-5aa2-4e7a-8e04-9a36f8f2eafd/quarantine",
    );
  });

  it("falls back to library track id routes", () => {
    expect(trackManagementApiPath({ id: 12 }, "quarantine")).toBe(
      "/api/manage/tracks/12/quarantine",
    );
  });
});
