import { screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

import { FederationOverview } from "./FederationOverview";

vi.mock("@/hooks/use-api", () => ({ useApi: vi.fn() }));

it("renders singleton node health without requiring peers", () => {
  vi.mocked(useApi).mockImplementation((path: string | null) => ({
    data: path?.endsWith("status")
      ? {
          local_node: { node_uid: "node-a", display_name: "Node A" },
          peer_count: 0,
          approved_peer_count: 0,
          pending_pairing_count: 0,
          peers: [],
        }
      : { peers: [] },
    loading: false,
    error: null,
    refetch: vi.fn(),
  }));
  renderWithAdminProviders(<FederationOverview />);
  expect(screen.getByText("Node A")).toBeInTheDocument();
  expect(screen.getByText("No active peer usage.")).toBeInTheDocument();
});
