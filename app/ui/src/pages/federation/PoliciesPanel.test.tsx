import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  expect(screen.getByText("node-b")).toHaveClass("crate-mono-label");
  expect(
    screen.getByRole("combobox", { name: "Grant preset" }),
  ).toBeInTheDocument();
  for (const label of ["Maximum streams", "Daily bytes", "Maximum results"]) {
    expect(
      screen.getByLabelText(label).closest('[data-slot="form-field"]'),
    ).toBeInTheDocument();
  }
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

it("updates a preset through the shared categorical control and respects management permission", async () => {
  const status = {
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
  };
  vi.mocked(useApi).mockReturnValue(status);
  vi.mocked(api).mockResolvedValue({});
  const { rerender } = renderWithAdminProviders(<PoliciesPanel canManage />);
  await userEvent.click(screen.getByRole("combobox", { name: "Grant preset" }));
  await userEvent.click(
    screen.getByRole("option", { name: "trusted library" }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/api/admin/federation/nodes/node-b/preset",
      "PATCH",
      { preset: "trusted_library" },
    ),
  );
  rerender(<PoliciesPanel canManage={false} />);
  expect(screen.getByRole("combobox", { name: "Grant preset" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Apply limits" })).toBeDisabled();
});
