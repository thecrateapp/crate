import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

import { Federation } from "./Federation";

vi.mock("@/hooks/use-api", () => ({ useApi: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: vi.fn() }));

const refetchImports = vi.fn();

describe("Federation imports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApi).mockImplementation((path: string | null) => {
      if (path === "/api/admin/federation/status") {
        return {
          data: {
            local_node: {
              node_uid: "node-a",
              display_name: "Node A",
              api_base_url: "https://node-a.test",
              active_key_id: "key-a",
            },
            peer_count: 1,
            approved_peer_count: 1,
            pending_pairing_count: 0,
            peers: [],
          },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      if (path === "/api/admin/federation/import-requests") {
        return {
          data: [
            {
              request_id: "request-1",
              node_uid: "node-b",
              title: "Pedals",
              status: "awaiting_approval",
              requested_by_user_id: 7,
              expected_bytes: 1000,
              reserved_bytes: 0,
              received_bytes: 0,
              manifest_digest: "sha256:abc",
              metadata_json: { global_album_uid: "global-pedals" },
              created_at: "2026-07-14T10:00:00Z",
            },
          ],
          loading: false,
          error: null,
          refetch: refetchImports,
        };
      }
      return {
        data: path?.includes("streaming-stats") ? { peers: [] } : [],
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    });
    vi.mocked(api).mockResolvedValue({});
  });

  it("shows manifest and accounting details and approves a pending import", async () => {
    renderWithAdminProviders(<Federation />);

    fireEvent.click(screen.getByRole("tab", { name: "Imports" }));
    expect(screen.getByText("Pedals")).toBeInTheDocument();
    expect(screen.getByText("sha256:abc")).toBeInTheDocument();
    expect(screen.getByText("global-pedals")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/admin/federation/import-requests/request-1/approve",
        "POST",
      ),
    );
    expect(refetchImports).toHaveBeenCalled();
  });

  it("can reject a pending import", async () => {
    renderWithAdminProviders(<Federation />);
    fireEvent.click(screen.getByRole("tab", { name: "Imports" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/admin/federation/import-requests/request-1/deny",
        "POST",
      ),
    );
  });
});
