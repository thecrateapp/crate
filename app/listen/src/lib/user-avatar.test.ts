import { describe, expect, it } from "vitest";
import { resolveUserAvatarSources, resolveUserAvatarUrl } from "./user-avatar";

describe("resolveUserAvatarSources", () => {
  it("returns nulls when avatar is null", () => {
    expect(resolveUserAvatarSources(null)).toEqual({
      primary: null,
      fallback: null,
    });
  });

  it("returns avatar as primary when no userId", () => {
    expect(resolveUserAvatarSources("/api/avatar.png")).toEqual({
      primary: "/api/avatar.png",
      fallback: null,
    });
  });

  it("returns api avatar as primary when userId and http avatar", () => {
    const result = resolveUserAvatarSources(
      "https://example.com/avatar.png",
      1,
    );
    expect(result.primary).toContain("/api/auth/users/1/avatar");
    expect(result.fallback).toBe("https://example.com/avatar.png");
  });
});

describe("resolveUserAvatarUrl", () => {
  it("returns null when avatar is null", () => {
    expect(resolveUserAvatarUrl(null)).toBeNull();
  });

  it("returns avatar path when provided", () => {
    expect(resolveUserAvatarUrl("/api/avatar.png")).toBe("/api/avatar.png");
  });
});
