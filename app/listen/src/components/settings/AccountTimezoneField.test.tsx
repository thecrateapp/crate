import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  deviceTimezone: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: mocks.api }));
vi.mock("@/lib/device-timezone", () => ({
  deviceTimezone: mocks.deviceTimezone,
}));

import { AccountTimezoneField } from "@/components/settings/AccountTimezoneField";
import {
  createMockAuthUser,
  renderWithListenProviders,
} from "@/test/render-with-listen-providers";

describe("AccountTimezoneField", () => {
  beforeEach(() => {
    mocks.api.mockReset().mockResolvedValue({});
    mocks.deviceTimezone.mockReset().mockReturnValue("Europe/Madrid");
  });

  it("offers the device timezone when it differs from the stored one", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn(async () => createMockAuthUser({ id: 7 }));
    renderWithListenProviders(<AccountTimezoneField />, {
      locale: "en",
      auth: {
        user: createMockAuthUser({ id: 7, timezone: "America/New_York" }),
        refetch,
      },
    });

    expect(screen.getByTestId("account-timezone")).toHaveTextContent(
      "America/New_York",
    );
    await user.click(screen.getByRole("button", { name: "Use Europe/Madrid" }));

    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith("/api/auth/profile", "PUT", {
        timezone: "Europe/Madrid",
      }),
    );
    expect(refetch).toHaveBeenCalled();
  });

  it("hides the action when the device already matches", () => {
    renderWithListenProviders(<AccountTimezoneField />, {
      locale: "en",
      auth: { user: createMockAuthUser({ id: 7, timezone: "Europe/Madrid" }) },
    });

    expect(screen.queryByRole("button")).toBeNull();
  });
});
