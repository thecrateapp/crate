import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, refetchRunsMock, refetchStatusMock, useApiMock } = vi.hoisted(
  () => ({
    apiMock: vi.fn(),
    refetchRunsMock: vi.fn(),
    refetchStatusMock: vi.fn(),
    useApiMock: vi.fn(),
  }),
);

vi.mock("@/hooks/use-api", () => ({
  useApi: useApiMock,
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ hasAnyCapability: () => true }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { GlobalCatalog } from "./GlobalCatalog";

describe("GlobalCatalog", () => {
  beforeEach(() => {
    apiMock.mockReset();
    refetchRunsMock.mockReset();
    refetchStatusMock.mockReset();
    useApiMock.mockImplementation((url: string) => {
      if (url.includes("/runs")) {
        return {
          data: { items: [] },
          loading: false,
          refetch: refetchRunsMock,
        };
      }
      if (url.includes("/duplicates")) {
        return {
          data: { items: [] },
          loading: false,
          refetch: vi.fn(),
        };
      }
      return {
        data: {
          enabled: true,
          counts: { artists: 2, albums: 3, tracks: 4, sources: 5 },
          last_run: null,
          stale_peer_count: 0,
          ambiguous_candidate_count: 1,
        },
        loading: false,
        refetch: refetchStatusMock,
      };
    });
  });

  it("renders status counts and queues manual reconciliation", async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValue({ task_id: 42, status: "queued" });

    render(<GlobalCatalog />);

    expect(
      screen.getByRole("heading", { name: "Global Catalog" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Artists")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reconcile" }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/global-catalog/reconcile",
        "POST",
        { mode: "incremental" },
      );
    });
    expect(refetchStatusMock).toHaveBeenCalled();
    expect(refetchRunsMock).toHaveBeenCalled();
  });
});
