import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

import { Federation } from "../Federation";

vi.mock("@/hooks/use-api", () => ({ useApi: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: vi.fn() }));

it("keeps the page as tab composition instead of a monolithic operations form", () => {
  vi.mocked(useApi).mockImplementation((path: string | null) => ({
    data: path?.endsWith("status")
      ? {
          local_node: null,
          peer_count: 0,
          approved_peer_count: 0,
          pending_pairing_count: 0,
          peers: [],
        }
      : path?.includes("streaming-stats")
        ? { peers: [] }
        : [],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }));
  renderWithAdminProviders(<Federation />);
  fireEvent.click(screen.getByRole("tab", { name: "Security" }));
  expect(screen.getByText("Key material")).toBeInTheDocument();
});
