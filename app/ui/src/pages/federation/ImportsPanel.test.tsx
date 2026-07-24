import { screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

import { ImportsPanel } from "./ImportsPanel";

vi.mock("@/hooks/use-api", () => ({ useApi: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: vi.fn() }));

it("renders import provenance accounting", () => {
  vi.mocked(useApi).mockReturnValue({
    data: [
      {
        request_id: "request-1",
        node_uid: "node-b",
        title: "Pedals",
        status: "completed",
        expected_bytes: 100,
        reserved_bytes: 100,
        received_bytes: 100,
        manifest_digest: "sha256:abc",
        metadata_json: { global_album_uid: "album-global" },
        created_at: "2026-07-14T10:00:00Z",
      },
    ],
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
  renderWithAdminProviders(<ImportsPanel canManage />);
  expect(screen.getByText("sha256:abc")).toBeInTheDocument();
  expect(screen.getByText("album-global")).toBeInTheDocument();
});
