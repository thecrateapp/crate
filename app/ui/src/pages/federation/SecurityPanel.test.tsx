import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

import { SecurityPanel } from "./SecurityPanel";

vi.mock("@/hooks/use-api", () => ({ useApi: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: vi.fn() }));

it("explains and reverses temporary risk actions", async () => {
  vi.mocked(useApi).mockImplementation((path: string | null) => ({
    data: path?.endsWith("status")
      ? {
          local_node: { node_uid: "node-a", active_key_id: "key-a" },
          peers: [{ node_uid: "node-b", display_name: "Node B" }],
        }
      : {
          latest_snapshot: { score: 82, algorithm_version: "crate-risk-v1" },
          observations: [],
          temporary_actions: [
            {
              id: 7,
              action_type: "deny",
              capability: "federation.stream.play",
              reason_code: "risk_score_critical",
              expires_at: "2026-07-14T12:15:00Z",
            },
          ],
        },
    loading: false,
    error: null,
    refetch: vi.fn(),
  }));
  vi.mocked(api).mockResolvedValue({});
  renderWithAdminProviders(<SecurityPanel canManage />);
  expect(screen.getByText(/Score: 82/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reverse" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/api/admin/federation/risk/actions/7/reverse",
      "POST",
    ),
  );
});
