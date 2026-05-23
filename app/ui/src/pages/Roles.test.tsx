import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
}));

import { api } from "@/lib/api";
import { Roles } from "./Roles";

const mockApi = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Roles", () => {
  it("renders role presets and grouped capabilities", async () => {
    mockApi.mockResolvedValue({
      capabilities: [
        "users.view",
        "users.status.manage",
        "roles.view",
        "library.view",
      ],
      roles: [
        {
          slug: "admin",
          name: "Admin",
          capabilities: ["users.view", "users.status.manage", "roles.view"],
          system: true,
        },
        {
          slug: "user",
          name: "User",
          capabilities: ["library.view"],
          system: true,
        },
      ],
    });

    render(<Roles />);

    await waitFor(() => {
      expect(screen.getByText("Admin")).toBeInTheDocument();
    });
    expect(screen.getAllByText("users.status.manage").length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("library.view").length).toBeGreaterThan(0);
    expect(mockApi).toHaveBeenCalledWith("/api/auth/roles");
  });
});
