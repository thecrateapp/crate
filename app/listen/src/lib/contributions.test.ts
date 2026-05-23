import { describe, expect, it } from "vitest";

import {
  contributionSourceLabel,
  contributorDisplayName,
  contributorProfilePath,
} from "@/lib/contributions";

describe("contribution helpers", () => {
  it("normalizes legacy upload sources to the public upload label", () => {
    expect(contributionSourceLabel("admin_upload")).toBe("upload");
    expect(contributionSourceLabel("listen_upload")).toBe("upload");
    expect(contributionSourceLabel("library_upload")).toBe("upload");
    expect(contributionSourceLabel("upload")).toBe("upload");
  });

  it("uses username as the primary public contributor identity", () => {
    const contributor = {
      user_username: "diego.rin",
      user_name: "Diego Rin Martin",
      user_email: "diego@example.com",
    };

    expect(contributorDisplayName(contributor)).toBe("@diego.rin");
    expect(contributorProfilePath(contributor)).toBe("/users/diego.rin");
  });

  it("falls back to display name when the contributor has no username", () => {
    expect(contributorDisplayName({ user_name: "Diego Rin Martin" })).toBe(
      "Diego Rin Martin",
    );
    expect(
      contributorProfilePath({ user_name: "Diego Rin Martin" }),
    ).toBeNull();
  });
});
