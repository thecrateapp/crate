import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ api: vi.fn(), toastError: vi.fn() }));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: mocks.api };
});

vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

import { useCrateFollow } from "@/components/crates/use-crate-follow";
import { I18nProvider } from "@/i18n";

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider initialLocale="en">{children}</I18nProvider>;
}

describe("useCrateFollow", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.toastError.mockReset();
  });

  it("follows optimistically and adjusts the follower count", async () => {
    mocks.api.mockResolvedValue({ ok: true });
    const { result } = renderHook(
      () =>
        useCrateFollow({
          crateId: "crate-1",
          initialFollowed: false,
          initialFollowerCount: 4,
          enabled: true,
        }),
      { wrapper },
    );

    await act(async () => result.current.toggle());

    expect(mocks.api).toHaveBeenCalledWith(
      "/api/crates/crate-1/follow",
      "POST",
    );
    expect(result.current.followed).toBe(true);
    expect(result.current.followerCount).toBe(5);
  });

  it("rolls back and toasts on failure without rethrowing", async () => {
    mocks.api.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(
      () =>
        useCrateFollow({
          crateId: "crate-1",
          initialFollowed: true,
          initialFollowerCount: 1,
          enabled: true,
        }),
      { wrapper },
    );

    await act(async () => {
      await expect(result.current.toggle()).resolves.toBeUndefined();
    });

    expect(mocks.api).toHaveBeenCalledWith(
      "/api/crates/crate-1/follow",
      "DELETE",
    );
    expect(result.current.followed).toBe(true);
    expect(result.current.followerCount).toBe(1);
    expect(mocks.toastError).toHaveBeenCalledOnce();
  });

  it("follows the server value when the source changes", () => {
    const { result, rerender } = renderHook(
      ({ followed }: { followed: boolean }) =>
        useCrateFollow({
          crateId: "crate-1",
          initialFollowed: followed,
          enabled: true,
        }),
      { wrapper, initialProps: { followed: false } },
    );

    rerender({ followed: true });

    expect(result.current.followed).toBe(true);
  });

  it("does nothing when disabled", async () => {
    const { result } = renderHook(
      () =>
        useCrateFollow({
          crateId: "crate-1",
          initialFollowed: false,
          enabled: false,
        }),
      { wrapper },
    );

    await act(async () => result.current.toggle());

    expect(mocks.api).not.toHaveBeenCalled();
  });
});
