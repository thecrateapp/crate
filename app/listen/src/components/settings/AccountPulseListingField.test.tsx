import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock("@/lib/api", () => ({ api: mocks.api }));

import { AccountPulseListingField } from "@/components/settings/AccountPulseListingField";
import {
  createMockAuthUser,
  renderWithListenProviders,
} from "@/test/render-with-listen-providers";

describe("AccountPulseListingField", () => {
  beforeEach(() => {
    mocks.api.mockReset().mockResolvedValue({});
  });

  it("lets a listener opt out of the Crate Pulse ranking", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn(async () => createMockAuthUser({ id: 7 }));
    renderWithListenProviders(<AccountPulseListingField />, {
      locale: "en",
      auth: { user: createMockAuthUser({ id: 7 }), refetch },
    });

    const toggle = screen.getByRole("switch", {
      name: "Show me in Crate Pulse",
    });
    expect(toggle).toBeChecked();

    await user.click(toggle);

    expect(mocks.api).toHaveBeenCalledWith("/api/auth/profile", "PUT", {
      pulse_listed: false,
    });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
    expect(toggle).not.toBeChecked();
  });

  it("restores the switch when the update fails", async () => {
    mocks.api.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    renderWithListenProviders(<AccountPulseListingField />, {
      locale: "en",
      auth: { user: createMockAuthUser({ id: 7, pulse_listed: false }) },
    });

    const toggle = screen.getByRole("switch", {
      name: "Show me in Crate Pulse",
    });
    await user.click(toggle);

    await waitFor(() => expect(toggle).not.toBeChecked());
  });
});
