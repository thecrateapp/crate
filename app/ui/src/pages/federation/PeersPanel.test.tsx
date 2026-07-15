import { screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

import { PeersPanel } from "./PeersPanel";

vi.mock("@/hooks/use-api", () => ({ useApi: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: vi.fn() }));

it("renders an explicit empty peer state", () => {
  vi.mocked(useApi).mockImplementation((path: string | null) => ({
    data: path?.endsWith("status") ? { peers: [] } : [],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }));
  renderWithAdminProviders(<PeersPanel canManage />);
  expect(screen.getByText("No peers configured.")).toBeInTheDocument();
});
