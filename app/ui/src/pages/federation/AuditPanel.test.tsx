import { screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

import { AuditPanel } from "./AuditPanel";

vi.mock("@/hooks/use-api", () => ({ useApi: vi.fn() }));

it("renders audited security operations with an absolute timestamp", () => {
  vi.mocked(useApi).mockReturnValue({
    data: [
      {
        id: 1,
        node_uid: "node-b",
        event_type: "risk.action_reversed",
        status: "success",
        created_at: "2026-07-14T10:00:00Z",
      },
    ],
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
  renderWithAdminProviders(<AuditPanel />);
  expect(screen.getByText("risk.action_reversed")).toBeInTheDocument();
  expect(document.querySelector("time")?.getAttribute("datetime")).toBe(
    "2026-07-14T10:00:00Z",
  );
});
