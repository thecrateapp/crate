import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import fixture from "../../../../tests/admin-e2e/fixtures/upcoming-1ao.json";
vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Upcoming } from "./Upcoming";
const mockedApi = vi.mocked(api);
describe("Upcoming bounded icon retirement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.mockImplementation(async (path) => {
      if (path === "/api/upcoming") return structuredClone(fixture);
      return { task_id: "sample-task" };
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it("uses display headings, labelled search and named text actions while retaining UX glyphs", async () => {
    const { container } = renderWithAdminProviders(<Upcoming />);
    await screen.findByRole("link", { name: "Luz de octubre" });
    expect(screen.getByRole("heading", { name: "Upcoming" })).toHaveClass(
      "font-display",
    );
    expect(
      screen
        .getByRole("textbox", { name: "Artist" })
        .closest(".crate-form-field"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear caches" }),
    ).not.toHaveAttribute("title");
    expect(
      screen.getByRole("button", { name: "Download release" }),
    ).toHaveTextContent("");
    expect(
      screen
        .getByRole("button", { name: "Download release" })
        .querySelector("svg"),
    ).toHaveAttribute("data-admin-ux", "upcoming-download");
    expect(
      container.querySelector('[data-admin-ux="upcoming-search"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector(".mt-5.bg-raised-surface"),
    ).toBeInTheDocument();
    for (const icon of container.querySelectorAll("svg")) {
      if (!icon.hasAttribute("data-admin-ux"))
        expect(icon.closest("button[role=combobox]")).toBeInTheDocument();
    }
  });
  it("preserves download and dismissal endpoint behavior and real item status", async () => {
    const user = userEvent.setup();
    renderWithAdminProviders(<Upcoming />);
    await user.click(
      await screen.findByRole("button", { name: "Download release" }),
    );
    expect(mockedApi).toHaveBeenCalledWith(
      "/api/acquisition/new-releases/71/download",
      "POST",
    );
    expect(toast.success).toHaveBeenCalledWith("Download started");
    await user.click(screen.getByRole("button", { name: "Dismiss release" }));
    expect(mockedApi).toHaveBeenCalledWith(
      "/api/acquisition/new-releases/72/dismiss",
      "POST",
    );
    expect(
      screen.queryByText("Niebla", { exact: true }),
    ).not.toBeInTheDocument();
  });
  it("keeps curation/acquisition and legacy administrator action gates", async () => {
    renderWithAdminProviders(<Upcoming />, {
      auth: {
        isAdmin: false,
        hasCapability: () => false,
        hasAnyCapability: () => false,
      },
    });
    await screen.findByRole("link", { name: "Luz de octubre" });
    for (const name of [
      "Clear caches",
      "Sync shows",
      "Download release",
      "Dismiss release",
    ])
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Calendar" })).toBeEnabled();
  });
  it("preserves search, strict type filters and calendar back/next UX", async () => {
    const user = userEvent.setup();
    const { container } = renderWithAdminProviders(<Upcoming />);
    const artist = await screen.findByRole("textbox", { name: "Artist" });
    await user.type(artist, "Luz Polar");
    expect(
      screen.queryByText("Luz de octubre", { exact: true }),
    ).not.toBeInTheDocument();
    await user.clear(artist);
    await user.click(screen.getByRole("button", { name: "shows" }));
    expect(
      screen.queryByText("Luz de octubre", { exact: true }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Calendar" }));
    expect(
      screen
        .getByRole("button", { name: "Previous month" })
        .querySelector("svg"),
    ).toHaveAttribute("data-admin-ux", "upcoming-previous");
    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(
      container.querySelector(".p-4.bg-raised-surface"),
    ).toBeInTheDocument();
  });
  it("keeps existing ten-second sync busy/refetch timer and failure feedback", async () => {
    vi.useFakeTimers();
    renderWithAdminProviders(<Upcoming />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Sync shows" }));
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Sync shows" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Sync shows" }).querySelector("svg"),
    ).toHaveAttribute("data-admin-ux", "upcoming-sync");
    await act(async () => vi.advanceTimersByTimeAsync(10000));
    expect(screen.getByRole("button", { name: "Sync shows" })).toBeEnabled();
    mockedApi.mockRejectedValueOnce(new Error("sample failure"));
    fireEvent.click(screen.getByRole("button", { name: "Sync shows" }));
    await act(async () => {});
    expect(toast.error).toHaveBeenCalledWith("Failed to sync shows");
  });
  it("uses accessible loading and textual empty state without redundant glyphs", async () => {
    let finish!: (data: unknown) => void;
    mockedApi.mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    const { container } = renderWithAdminProviders(<Upcoming />);
    expect(
      screen.getByRole("status", { name: "Loading upcoming items" }),
    ).toBeInTheDocument();
    await act(async () => finish({ items: [] }));
    expect(screen.getByText("Nothing upcoming")).toBeInTheDocument();
    const empty = screen
      .getByText("Nothing upcoming")
      .closest('[role="status"]');
    expect(empty).toHaveClass("bg-raised-surface", "shadow-none");
    expect(container.querySelectorAll("svg")).toHaveLength(5); // Search, two view controls and two compact header actions.
  });

  it("uses named icon-only view buttons with pressed state", async () => {
    const user = userEvent.setup();
    renderWithAdminProviders(<Upcoming />);
    await screen.findByRole("link", { name: "Luz de octubre" });
    const list = screen.getByRole("button", { name: "List" });
    const calendar = screen.getByRole("button", { name: "Calendar" });
    expect(list.textContent).toBe("");
    expect(calendar.textContent).toBe("");
    expect(list).toHaveAttribute("aria-pressed", "true");
    expect(list.querySelector("svg")).toHaveAttribute(
      "data-admin-ux",
      "upcoming-view-list",
    );
    await user.click(calendar);
    expect(calendar).toHaveAttribute("aria-pressed", "true");
    expect(list).toHaveAttribute("aria-pressed", "false");
  });
});
