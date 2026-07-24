import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

import { DirectoriesPanel } from "./DirectoriesPanel";

vi.mock("@/hooks/use-api", () => ({ useApi: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: vi.fn() }));

const refetch = vi.fn();

describe("DirectoriesPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApi).mockReturnValue({
      data: [
        {
          subscription_uid: "sub-1",
          url: "https://directory.example/nodes.json",
          trusted_keys_json: [{ key_id: "directory-2026" }],
          refresh_interval_seconds: 3600,
          state: "active",
          last_success_at: "2026-07-14T10:00:00Z",
          last_error_code: null,
          candidates: [
            {
              id: 4,
              node_uid: "node-b",
              display_name: "Node B",
              descriptor_url: "https://node-b.example/.well-known/crate-node",
              descriptor_digest: "abc123",
              state: "pending",
              metadata_json: { api_base_url: "https://node-b.example" },
              peer_trust_state: null,
            },
          ],
        },
      ],
      loading: false,
      error: null,
      refetch,
    });
    vi.mocked(api).mockResolvedValue({});
  });

  it("shows signature freshness and pairs through the normal flow", async () => {
    renderWithAdminProviders(<DirectoriesPanel canManage />);

    expect(screen.getByText("directory-2026")).toBeInTheDocument();
    expect(screen.getByText("Node B")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pair Node B" }));

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/admin/federation/directory-candidates/4/pair",
        "POST",
        { outbound_grant: "discovery" },
      ),
    );
    expect(refetch).toHaveBeenCalled();
  });

  it("creates a subscription without auto-approving discovered peers", async () => {
    renderWithAdminProviders(<DirectoriesPanel canManage />);

    fireEvent.change(screen.getByLabelText("Directory URL"), {
      target: { value: "https://new-directory.example/nodes.json" },
    });
    fireEvent.change(screen.getByLabelText("Trusted key ID"), {
      target: { value: "new-key" },
    });
    fireEvent.change(screen.getByLabelText("Trusted Ed25519 public key"), {
      target: { value: "base64-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add directory" }));

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/admin/federation/directories",
        "POST",
        expect.objectContaining({
          url: "https://new-directory.example/nodes.json",
          trusted_key_id: "new-key",
          trusted_public_key: "base64-key",
        }),
      ),
    );
  });
});
