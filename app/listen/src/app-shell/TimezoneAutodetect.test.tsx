import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  deviceTimezone: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: mocks.api }));
vi.mock("@/lib/device-timezone", () => ({
  deviceTimezone: mocks.deviceTimezone,
}));

import { TimezoneAutodetect } from "@/app-shell/TimezoneAutodetect";
import {
  createMockAuthUser,
  renderWithListenProviders,
} from "@/test/render-with-listen-providers";

describe("TimezoneAutodetect", () => {
  beforeEach(() => {
    mocks.api.mockReset().mockResolvedValue({});
    mocks.deviceTimezone.mockReset().mockReturnValue("Europe/Madrid");
  });

  it("stores the device timezone once when the user has none", async () => {
    const refetch = vi.fn(async () => createMockAuthUser({ id: 7 }));
    renderWithListenProviders(<TimezoneAutodetect />, {
      auth: { user: createMockAuthUser({ id: 7, timezone: null }), refetch },
    });

    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith("/api/auth/profile", "PUT", {
        timezone: "Europe/Madrid",
      }),
    );
    await waitFor(() => expect(refetch).toHaveBeenCalled());
    expect(mocks.api).toHaveBeenCalledTimes(1);
  });

  it("never overrides a stored timezone", () => {
    renderWithListenProviders(<TimezoneAutodetect />, {
      auth: {
        user: createMockAuthUser({ id: 7, timezone: "America/New_York" }),
      },
    });

    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("does nothing against servers that do not expose a timezone", () => {
    renderWithListenProviders(<TimezoneAutodetect />, {
      auth: { user: createMockAuthUser({ id: 7 }) },
    });

    expect(mocks.api).not.toHaveBeenCalled();
  });
});
