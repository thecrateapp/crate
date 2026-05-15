import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUserAvatarUrl } from "./use-user-avatar-url";

describe("useUserAvatarUrl", () => {
  it("returns null when no avatar is provided", () => {
    const { result } = renderHook(() => useUserAvatarUrl(null));
    expect(result.current.avatarUrl).toBeNull();
  });

  it("returns avatar URL when avatar is provided", () => {
    const { result } = renderHook(() =>
      useUserAvatarUrl("https://example.com/avatar.png"),
    );
    expect(result.current.avatarUrl).toBe("https://example.com/avatar.png");
  });

  it("switches to fallback on error when userId is provided", () => {
    const { result } = renderHook(() =>
      useUserAvatarUrl("https://example.com/avatar.png", 1),
    );
    act(() => {
      result.current.handleAvatarError();
    });
    expect(result.current.avatarUrl).not.toBeNull();
  });

  it("returns null on error when no fallback exists", () => {
    const { result } = renderHook(() => useUserAvatarUrl("invalid"));
    act(() => {
      result.current.handleAvatarError();
    });
    expect(result.current.avatarUrl).toBeNull();
  });
});
