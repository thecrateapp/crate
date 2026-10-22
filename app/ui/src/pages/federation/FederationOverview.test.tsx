import { screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

import { FederationOverview } from "./FederationOverview";

vi.mock("@/hooks/use-api", () => ({ useApi: vi.fn() }));

it("renders node identity and the empty streaming state without peers", () => {
  vi.mocked(useApi).mockImplementation((path: string | null) => ({
    data: path?.endsWith("status")
      ? {
          local_node: {
            node_uid: "node-a",
            display_name: "Node A",
            api_base_url: "https://node-a.test",
          },
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
  expect(screen.getByText("node-a")).toBeInTheDocument();
  expect(screen.getByText("https://node-a.test")).toBeInTheDocument();
  expect(screen.getByText("APPROVED PEERS")).toBeInTheDocument();
  expect(screen.getByText("No active peer usage.")).toBeInTheDocument();
});

it("keeps each peer's stream usage aligned with its identity", () => {
  vi.mocked(useApi).mockImplementation((path: string | null) => ({
    data: path?.endsWith("status")
      ? {
          local_node: { node_uid: "node-a", display_name: "Node A" },
          peer_count: 1,
          approved_peer_count: 1,
          pending_pairing_count: 2,
          peers: [],
        }
      : {
          peers: [
            {
              node_uid: "node-b",
              display_name: "Peer B",
              preset: "trusted_library",
              active_streams: 3,
              daily_bytes: 2048,
            },
          ],
        },
    loading: false,
    error: null,
    refetch: vi.fn(),
  }));
  renderWithAdminProviders(<FederationOverview />);
  expect(screen.getByText("Peer B")).toBeInTheDocument();
  expect(screen.getByText("trusted_library")).toBeInTheDocument();
  expect(screen.getByText("3")).toBeInTheDocument();
  expect(screen.getByText("2.0 KB")).toBeInTheDocument();
});
