import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: apiMock }));

import { AuthContext } from "@/contexts/AuthContext";
import { notifyBackupsChanged } from "@/lib/backups";
import { createMockAuthValue } from "@/test/render-with-admin-providers";
import { useBackupsFailingCount } from "./use-backups-failing";

function wrapperFor(capabilities: string[]) {
  const authValue = createMockAuthValue({
    hasAnyCapability: (required: readonly string[]) =>
      required.some((capability) => capabilities.includes(capability)),
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthContext.Provider value={authValue}>{children}</AuthContext.Provider>
    );
  };
}

beforeEach(() => apiMock.mockReset());

describe("useBackupsFailingCount", () => {
  it("counts failing destinations and refetches after a backups change", async () => {
    apiMock.mockResolvedValue({ failing_count: 1 });
    const { result } = renderHook(() => useBackupsFailingCount(), {
      wrapper: wrapperFor(["system.backups.manage"]),
    });
    await waitFor(() => expect(result.current).toBe(1));
    expect(apiMock).toHaveBeenCalledWith(
      "/api/admin/backups/overview",
      "GET",
      undefined,
      expect.any(Object),
    );
    apiMock.mockResolvedValue({ failing_count: 3 });
    act(() => notifyBackupsChanged());
    await waitFor(() => expect(result.current).toBe(3));
  });

  it("asks nothing without the capability", () => {
    const { result } = renderHook(() => useBackupsFailingCount(), {
      wrapper: wrapperFor(["settings.manage"]),
    });
    expect(result.current).toBe(0);
    expect(apiMock).not.toHaveBeenCalled();
  });
});
