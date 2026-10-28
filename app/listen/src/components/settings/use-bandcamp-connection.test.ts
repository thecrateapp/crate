import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, notifyMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  notifyMock: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/lib/platform", () => ({ isTauriRuntime: false }));
vi.mock("@crate/ui/lib/notify", () => ({ notify: notifyMock }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { useBandcampConnection } from "./use-bandcamp-connection";

describe("useBandcampConnection", () => {
  beforeEach(() => {
    apiMock.mockReset();
    notifyMock.success.mockReset();
    notifyMock.error.mockReset();
  });

  it("does not report a successful disconnect as failed when the refresh fails", async () => {
    apiMock.mockResolvedValueOnce({ connected: false });
    const { result } = renderHook(() => useBandcampConnection());
    await waitFor(() => expect(result.current.loading).toBe(false));

    apiMock
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("status unavailable"));
    await act(async () => {
      await result.current.disconnectBandcamp();
    });

    expect(notifyMock.success).toHaveBeenCalledWith(
      "settings.bandcamp.toasts.disconnected",
    );
    expect(notifyMock.error).not.toHaveBeenCalled();
    expect(result.current.loadError).toBe(true);
  });
});
