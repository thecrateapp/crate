import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

import { PairingPanel } from "./PairingPanel";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));

it("starts pairing through the verified pairing endpoint", async () => {
  vi.mocked(api).mockResolvedValue({});
  renderWithAdminProviders(<PairingPanel canManage onChanged={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Pairing URL"), {
    target: { value: "https://peer.example" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Pair" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/api/admin/federation/pairing/start",
      "POST",
      { url: "https://peer.example" },
    ),
  );
});
