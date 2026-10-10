import { describe, expect, it } from "vitest";

import {
  canCopy,
  canEdit,
  canFollow,
  canLeave,
  canManage,
  type CollaborationAccess,
} from "@/lib/collaboration-access";

describe("collaboration access", () => {
  it.each<[CollaborationAccess, "public" | "private", boolean[]]>([
    ["owner", "public", [true, true, false, false, false]],
    ["collaborator", "private", [true, false, true, false, false]],
    ["public", "public", [false, false, false, true, true]],
    ["public", "private", [false, false, false, false, false]],
  ])("%s on a %s entity", (access, visibility, expected) => {
    const subject = { access, visibility };
    expect([
      canEdit(subject),
      canManage(subject),
      canLeave(subject),
      canFollow(subject),
      canCopy(subject),
    ]).toEqual(expected);
  });

  it("treats a missing payload as read-only", () => {
    expect(canEdit(undefined)).toBe(false);
    expect(canFollow(null)).toBe(false);
  });
});
