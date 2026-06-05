import { describe, expect, it } from "vitest";

import {
  userCanAccessAdminConsole,
  userHasAnyCapability,
  userHasCapability,
  type AuthUser,
} from "./AuthContext";

function user(role: string, capabilities: string[] = []): AuthUser {
  return {
    id: 1,
    email: `${role}@example.test`,
    name: role,
    role,
    roles: [role],
    capabilities,
  };
}

describe("AuthContext permission helpers", () => {
  it("treats owner and admin roles as legacy wildcard roles", () => {
    expect(userHasCapability(user("owner"), "library.metadata.write")).toBe(
      true,
    );
    expect(userHasCapability(user("admin"), "ops.runtime.manage")).toBe(true);
  });

  it("checks explicit capabilities for partial roles", () => {
    const editor = user("editor", ["library.view", "library.metadata.write"]);
    expect(userHasCapability(editor, "library.metadata.write")).toBe(true);
    expect(userHasCapability(editor, "admin.access")).toBe(false);
    expect(userHasAnyCapability(editor, ["admin.access", "library.view"])).toBe(
      true,
    );
  });

  it("treats multirole admin users as legacy wildcard users", () => {
    expect(
      userHasCapability(
        { ...user("curator"), roles: ["curator", "admin"] },
        "users.delete",
      ),
    ).toBe(true);
  });

  it("does not allow plain library viewers into the admin console", () => {
    expect(userCanAccessAdminConsole(user("user", ["library.view"]))).toBe(
      false,
    );
  });

  it("allows operational partial roles into the admin console", () => {
    expect(
      userCanAccessAdminConsole(
        user("editor", ["library.view", "library.metadata.write"]),
      ),
    ).toBe(true);
  });

  it("allows ops roles into the admin console", () => {
    expect(userCanAccessAdminConsole(user("ops", ["ops.tasks.manage"]))).toBe(
      true,
    );
  });

  it("allows playlist curators into the admin console", () => {
    expect(
      userCanAccessAdminConsole(
        user("curator", ["library.view", "curation.playlists.write"]),
      ),
    ).toBe(true);
  });

  it("allows genre curators into the admin console", () => {
    expect(
      userCanAccessAdminConsole(
        user("curator", ["library.view", "curation.genres.write"]),
      ),
    ).toBe(true);
  });
});
