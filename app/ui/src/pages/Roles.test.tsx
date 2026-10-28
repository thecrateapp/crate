import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
      expect(
        screen.getByRole("heading", { name: "Admin", level: 3 }),
      ).toBeInTheDocument();
    });
    expect(screen.getAllByText("users.status.manage").length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("library.view").length).toBeGreaterThan(0);
    expect(mockApi).toHaveBeenCalledWith("/api/auth/roles");
  });

  it("uses singular labels for counts of one", async () => {
    mockApi.mockResolvedValue({
      capabilities: ["roles.view"],
      roles: [
        {
          slug: "observer",
          name: "Observer",
          capabilities: ["roles.view"],
          system: true,
        },
      ],
    });

    render(<Roles />);

    expect(await screen.findByText("1 role")).toBeInTheDocument();
    expect(screen.getByText("1 grant")).toBeInTheDocument();
    expect(screen.getAllByText("1 capability")).toHaveLength(2);
    expect(screen.queryByText(/^1 (?:roles|grants|capabilities)$/)).toBeNull();
  });

  it("compares grants per role in the capability matrix", async () => {
    mockApi.mockResolvedValue({
      capabilities: ["library.view", "library.metadata.write", "users.view"],
      roles: [
        {
          slug: "librarian",
          name: "Librarian",
          capabilities: ["library.view", "library.metadata.write"],
          system: true,
        },
        {
          slug: "observer",
          name: "Observer",
          capabilities: ["library.view", "users.view"],
          system: true,
        },
      ],
    });

    render(<Roles />);

    const matrix = await screen.findByRole("table", {
      name: "library capabilities by role",
    });
    expect(matrix).toBeInTheDocument();
    expect(
      screen.getAllByRole("columnheader", { name: "Librarian" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("columnheader", { name: "Observer" }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("library.metadata.write")).toBeInTheDocument();
    expect(screen.getAllByText("Yes")).toHaveLength(4);
  });

  it("recovers from a failed catalog read and presents an empty catalog", async () => {
    const user = userEvent.setup();
    mockApi
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({ roles: [], capabilities: [] });

    render(<Roles />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "role and capability catalog could not be loaded",
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByText("No role presets are currently defined."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "No capability data is available for this role catalog.",
      ),
    ).toBeInTheDocument();
  });
});
