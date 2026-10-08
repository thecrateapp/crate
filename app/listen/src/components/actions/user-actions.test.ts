import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";

import { buildUserActions, userProfilePath } from "./user-actions";

const t = ((key: string) => key) as unknown as TFunction;

function keys(entries: ReturnType<typeof buildUserActions>) {
  return entries.map((entry) => entry.key);
}

describe("buildUserActions", () => {
  const base = {
    user: { id: 3, username: "maria", name: "Maria" },
    following: false,
    onToggleFollow: vi.fn(),
    onViewProfile: vi.fn(),
    onShare: vi.fn(),
  };

  it("builds follow, profile and share entries", () => {
    const entries = buildUserActions(base, t);
    expect(keys(entries)).toEqual(["follow", "profile", "share"]);
    expect(entries[0]).toMatchObject({ label: "common.follow" });
  });

  it("switches to unfollow when following", () => {
    const entries = buildUserActions({ ...base, following: true }, t);
    expect(entries[0]).toMatchObject({
      label: "common.unfollow",
      active: true,
    });
  });

  it("omits follow for self and profile/share without a username", () => {
    expect(keys(buildUserActions({ ...base, isSelf: true }, t))).toEqual([
      "profile",
      "share",
    ]);
    expect(
      keys(
        buildUserActions(
          { ...base, user: { id: 3, username: null, name: "Maria" } },
          t,
        ),
      ),
    ).toEqual(["follow"]);
  });

  it("disables follow while pending", () => {
    const entries = buildUserActions({ ...base, followPending: true }, t);
    expect(entries[0]).toMatchObject({ disabled: true });
  });
});

describe("userProfilePath", () => {
  it("normalizes usernames", () => {
    expect(userProfilePath("@maria")).toBe("/users/maria");
    expect(userProfilePath(null)).toBe("/people");
  });
});
