import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: apiMock }));

import { api } from "@/lib/api";
import { Roles } from "./Roles";

beforeEach(() => {
  vi.mocked(api).mockReset();
  apiMock.mockResolvedValue({ capabilities: [], roles: [] });
});
afterEach(cleanup);

describe("Roles page header", () => {
  it("uses the canonical display heading", async () => {
    render(<Roles />);

    expect(
      await screen.findByRole("heading", { name: "Roles & Permissions" }),
    ).toHaveClass("font-display", "font-extrabold");
  });
});
