import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: request }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { Playlists } from "./Playlists";

describe("Playlist read and mutation recovery", () => {
  beforeEach(() => {
    request.mockReset().mockImplementation(async (path: string) => {
      if (path === "/api/playlists/filter-options")
        return { genres: ["ambient"], artists: [], formats: [], keys: [] };
      if (path === "/api/capabilities")
        return { smart_mix: { available: false } };
      return [];
    });
  });
  it("offers a real retry after the list read fails", async () => {
    request.mockRejectedValueOnce(new Error("offline"));
    renderWithAdminProviders(<Playlists />);
    expect(
      await screen.findByText("System playlists could not be loaded."),
    ).toBeVisible();
    expect(
      screen.queryByText("No playlists for this view yet"),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Retry playlists" }),
    );
    expect(
      await screen.findByText("No playlists for this view yet"),
    ).toBeVisible();
  });
  it("keeps a delete confirmation pending and retains it on failure", async () => {
    let rejectDelete!: (error: Error) => void;
    request.mockImplementation((path: string, method = "GET") => {
      if (method === "DELETE")
        return new Promise((_resolve, reject) => {
          rejectDelete = reject;
        });
      if (path === "/api/admin/system-playlists")
        return Promise.resolve([
          {
            id: 7,
            name: "Diagnostic mix",
            description: "",
            generation_mode: "static",
            is_curated: true,
            is_active: true,
            track_count: 1,
            follower_count: 0,
            total_duration: 60,
          },
        ]);
      return Promise.resolve([]);
    });
    renderWithAdminProviders(<Playlists />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Delete Diagnostic mix" }),
    );
    const dialog = screen.getByRole("alertdialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete" }),
    );
    expect(
      within(dialog).getByRole("button", { name: "Delete" }),
    ).toBeDisabled();
    await act(async () => rejectDelete(new Error("offline")));
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Delete" }),
      ).toBeEnabled(),
    );
    expect(screen.getByRole("alertdialog")).toBeVisible();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Playlist could not be deleted.",
    );
  });
  it("recovers the smart-rule catalog instead of presenting an empty Genre selector", async () => {
    let reads = 0;
    request.mockImplementation(async (path: string) => {
      if (path === "/api/playlists/filter-options") {
        reads += 1;
        if (reads === 1) throw new Error("offline");
        return { genres: ["ambient"], artists: [], formats: [], keys: [] };
      }
      return [];
    });
    renderWithAdminProviders(<Playlists />);
    await screen.findByText("No playlists for this view yet");
    await userEvent.click(screen.getByRole("button", { name: "New smart" }));
    expect(
      await screen.findByText("Rule options could not be loaded."),
    ).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Select genre" }),
    ).toBeDisabled();
    await userEvent.click(
      screen.getByRole("button", { name: "Retry rule options" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Select genre" }),
      ).toBeEnabled(),
    );
    await userEvent.click(
      screen.getByRole("combobox", { name: "Select genre" }),
    );
    expect(
      await screen.findByRole("option", { name: "ambient" }),
    ).toBeVisible();
  });
  it("keeps an invalid smart limit visible with an associated error and does not POST", async () => {
    renderWithAdminProviders(<Playlists />);
    await screen.findByText("No playlists for this view yet");
    await userEvent.click(screen.getByRole("button", { name: "New smart" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Name" }),
      "Validation mix",
    );
    await userEvent.click(
      screen.getByRole("combobox", { name: "Select genre" }),
    );
    await userEvent.click(
      await screen.findByRole("option", { name: "ambient" }),
    );
    const limit = screen.getByRole("spinbutton", { name: "Limit" });
    await userEvent.clear(limit);
    await userEvent.type(limit, "0");
    await userEvent.click(
      screen.getByRole("button", { name: "Create & open" }),
    );
    expect(limit).toHaveValue(0);
    expect(limit).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a whole number from 1 to 500.",
    );
    expect(request.mock.calls.some(([, method]) => method === "POST")).toBe(
      false,
    );
  });
  it("does not submit a fractional static featured rank", async () => {
    renderWithAdminProviders(<Playlists />);
    await screen.findByText("No playlists for this view yet");
    await userEvent.click(screen.getByRole("button", { name: "New static" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Name" }),
      "Static validation",
    );
    await userEvent.type(
      screen.getByRole("spinbutton", { name: "Featured rank" }),
      "1.5",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Create & open" }),
    );
    expect(
      screen.getByRole("spinbutton", { name: "Featured rank" }),
    ).toHaveAttribute("aria-invalid", "true");
    expect(request.mock.calls.some(([, method]) => method === "POST")).toBe(
      false,
    );
  });
  it("keeps a failed refresh visible when a local filter has no matches", async () => {
    let reads = 0;
    request.mockImplementation(async (path: string, method = "GET") => {
      if (method === "POST") return {};
      if (path === "/api/admin/system-playlists" && reads++ === 0)
        return [
          {
            id: 7,
            name: "Diagnostic mix",
            description: "",
            generation_mode: "static",
            is_curated: true,
            is_active: true,
            track_count: 1,
            follower_count: 0,
            total_duration: 60,
          },
        ];
      throw new Error("offline");
    });
    renderWithAdminProviders(<Playlists />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Deactivate Diagnostic mix" }),
    );
    const message =
      "System playlists could not be refreshed. Showing the last successful results.";
    expect(await screen.findByText(message)).toBeVisible();
    await userEvent.type(
      screen.getByRole("searchbox", { name: "Search playlists" }),
      "absent",
    );
    expect(screen.getByText(message)).toBeVisible();
  });
});
