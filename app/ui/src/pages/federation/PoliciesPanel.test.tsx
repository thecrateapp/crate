import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

import { PoliciesPanel } from "./PoliciesPanel";

vi.mock("@/hooks/use-api", () => ({ useApi: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: vi.fn() }));

it("updates typed peer limits without a raw JSON editor", async () => {
  vi.mocked(useApi).mockReturnValue({
    data: {
      peers: [
        {
          node_uid: "node-b",
          trust_state: "approved",
          default_grant_preset: "catalog",
        },
      ],
    },
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
  vi.mocked(api).mockResolvedValue({});
  renderWithAdminProviders(<PoliciesPanel canManage />);
  fireEvent.change(screen.getByLabelText("Maximum streams"), {
    target: { value: "4" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply limits" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/api/admin/federation/nodes/node-b/limits",
      "PATCH",
      { max_streams: 4, daily_bytes: null, max_results: null },
    ),
  );
});
