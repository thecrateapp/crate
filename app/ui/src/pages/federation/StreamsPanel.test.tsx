import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

import { StreamsPanel } from "./StreamsPanel";

vi.mock("@/hooks/use-api", () => ({ useApi: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: vi.fn() }));

it("lists and revokes active tickets", async () => {
  vi.mocked(useApi).mockImplementation((path: string | null) => ({
    data: path?.endsWith("streams")
      ? [
          {
            ticket_uid: "ticket-1",
            node_uid: "node-b",
            subject_hash: null,
            expires_at: "2026-07-14T12:00:00Z",
          },
        ]
      : { peers: [] },
    loading: false,
    error: null,
    refetch: vi.fn(),
  }));
  vi.mocked(api).mockResolvedValue({});
  renderWithAdminProviders(<StreamsPanel canManage />);
  fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/api/admin/federation/streams/ticket-1/revoke",
      "POST",
    ),
  );
});
