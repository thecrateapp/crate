import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Contributions } from "./Contributions";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import fixture from "../../../../tests/admin-e2e/fixtures/contributions-1af.json";
import { api } from "@/lib/api";
import { toast } from "sonner";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
const mockApi = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.mockResolvedValue(structuredClone(fixture));
});
afterEach(cleanup);

describe("Contributions text and real contracts", () => {
  it("uses a display heading and one precisely named compact refresh", async () => {
    renderWithAdminProviders(<Contributions />);
    await screen.findByText("Luz de octubre");
    expect(screen.getByRole("heading", { name: "Contributions" })).toHaveClass(
      "font-display",
      "font-extrabold",
    );
    const refresh = screen.getByRole("button", { name: "Refresh" });
    expect(refresh).toHaveAttribute("data-size", "icon-lg");
    expect(refresh).toHaveAttribute("data-variant", "ghost");
    expect(refresh).not.toHaveAttribute("title");
    expect(document.querySelectorAll("svg")).toHaveLength(1);
    expect(refresh.querySelector("svg")).toHaveAttribute(
      "data-admin-ux",
      "header-refresh",
    );
    expect(mockApi).toHaveBeenCalledExactlyOnceWith(
      "/api/manage/contributions?limit=150",
    );
  });

  it("retains contributor precedence, source words, status and real metadata", async () => {
    renderWithAdminProviders(<Contributions />);
    await screen.findByText("Luz de octubre");
    const count = screen.getByText("4 contributions", { exact: true });
    expect(count).toBeInTheDocument();
    expect(count.closest('[data-slot="info-badge"]')).toBeInTheDocument();
    const contributionList = screen.getByRole("list", {
      name: "Community library contributions",
    });
    expect(within(contributionList).getAllByRole("listitem")).toHaveLength(4);
    for (const text of [
      "Lucía de muestra",
      "@lucia",
      "mar-de-muestra",
      "curadora@example.test",
      "Unknown user",
      "Bandcamp",
      "Upload",
      "Admin upload",
      "external sample",
      "withdrawn",
      "8 tracks",
      "30:53",
      fixture.items[0]!.source_ref,
    ]) {
      expect(screen.getByText(text, { exact: true })).toBeInTheDocument();
    }
    expect(
      screen.getAllByText("imported")[0]?.closest("[data-tone]"),
    ).toHaveAttribute("data-tone", "on");
    expect(
      screen.getByText("withdrawn").closest("[data-tone]"),
    ).toHaveAttribute("data-tone", "off");
    expect(screen.queryByText("lucia@example.test")).not.toBeInTheDocument();
    expect(screen.queryByText("0 tracks")).not.toBeInTheDocument();
  });

  it("keeps canonical album links and omits a link without an album id", async () => {
    renderWithAdminProviders(<Contributions />);
    const link = await screen.findByRole("link", { name: "Luz de octubre" });
    expect(link).toHaveAttribute("href", "/artists/costa-norte/luz-de-octubre");
    expect(link).toHaveClass("min-h-11");
    expect(
      screen.queryByRole("link", { name: "Mareas" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Mareas")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("preserves artwork helper output rather than treating artwork as a glyph", async () => {
    mockApi.mockResolvedValue({
      items: [{ ...fixture.items[0], has_cover: true }],
      count: 1,
    });
    renderWithAdminProviders(<Contributions />);
    await screen.findByText("Luz de octubre");
    expect(document.querySelector("img")).toHaveAttribute(
      "src",
      "/api/albums/41/cover",
    );
    expect(document.querySelector("img")).toHaveAttribute(
      "alt",
      "Luz de octubre",
    );
  });

  it("bounds both loading glyphs and prevents overlapping refresh reads", async () => {
    let resolve!: (value: unknown) => void;
    mockApi.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    renderWithAdminProviders(<Contributions />);
    const refresh = screen.getByRole("button", { name: "Refresh" });
    expect(refresh).toBeDisabled();
    expect(refresh).toHaveAttribute("aria-busy", "true");
    expect(document.querySelectorAll("svg[data-admin-ux]")).toHaveLength(2);
    for (const glyph of document.querySelectorAll("svg"))
      expect(glyph).toHaveAttribute("aria-hidden", "true");
    await userEvent.click(refresh);
    expect(mockApi).toHaveBeenCalledTimes(1);
    await act(async () => resolve(fixture));
    expect(refresh).toBeEnabled();
    expect(refresh).not.toHaveAttribute("aria-busy", "true");
    expect(document.querySelectorAll("svg")).toHaveLength(1);
    expect(refresh.querySelector("svg")).toHaveAttribute(
      "data-admin-ux",
      "header-refresh",
    );
  });

  it("refreshes through the same GET from the keyboard", async () => {
    const user = userEvent.setup();
    renderWithAdminProviders(<Contributions />);
    await screen.findByText("Luz de octubre");
    const refresh = screen.getByRole("button", { name: "Refresh" });
    refresh.focus();
    mockApi.mockResolvedValue({ items: fixture.items.slice(2), count: 2 });
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.queryByText("Luz de octubre")).not.toBeInTheDocument(),
    );
    expect(mockApi.mock.calls).toEqual([
      ["/api/manage/contributions?limit=150"],
      ["/api/manage/contributions?limit=150"],
    ]);
    expect(screen.getByText("Mareas")).toBeInTheDocument();
  });

  it("keeps empty and missing-items responses empty without inventing counts", async () => {
    mockApi.mockResolvedValue({ count: 99 });
    renderWithAdminProviders(<Contributions />);
    await screen.findByText("No contributions yet");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/99/)).not.toBeInTheDocument();
    expect(screen.queryByText("99", { exact: true })).not.toBeInTheDocument();
  });

  it("distinguishes an initial read error from an empty library", async () => {
    mockApi.mockRejectedValue(new Error("Sample unavailable"));
    renderWithAdminProviders(<Contributions />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Contributions unavailable",
    );
    expect(screen.queryByText("No contributions yet")).not.toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith("Sample unavailable");
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
  });

  it("retains previous items on refresh failure and supports the generic error fallback", async () => {
    renderWithAdminProviders(<Contributions />);
    await screen.findByText("Luz de octubre");
    mockApi.mockRejectedValue(null);
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Failed to load contributions"),
    );
    expect(screen.getByText("Luz de octubre")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Refresh failed · showing last results",
    );
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
  });

  it("keeps the Library fallback for an empty source", async () => {
    mockApi.mockResolvedValue({
      items: [{ ...fixture.items[0], source: "" }],
      count: 1,
    });
    renderWithAdminProviders(<Contributions />);
    await screen.findByText("Library");
  });
});
