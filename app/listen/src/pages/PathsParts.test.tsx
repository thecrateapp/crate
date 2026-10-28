import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { api } from "@/lib/api";
import { EndpointPanel } from "./PathsParts";
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: vi.fn(),
}));
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(api).mockReset();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
const elapse = async () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
describe("path endpoint search", () => {
  it("waits300ms and selects the real identity with its cover", async () => {
    vi.mocked(api).mockImplementation(async (url) =>
      url === "/api/genres"
        ? []
        : { artists: [{ id: 7, name: "Coast", entity_uid: "artist-uid" }] },
    );
    const select = vi.fn();
    renderWithListenProviders(
      <EndpointPanel side="origin" selected={null} onSelect={select} />,
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "coast" },
    });
    expect(api).not.toHaveBeenCalled();
    await elapse();
    const row = screen.getByRole("button", { name: "Coast" });
    expect(row.querySelector('[data-slot="media-cover"]')).toBeInTheDocument();
    fireEvent.click(row);
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "artist",
        value: "artist-uid",
        label: "Coast",
      }),
    );
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });
  it("ignores an old response after the query is cleared", async () => {
    let resolve!: (value: unknown) => void;
    const response = new Promise((done) => {
      resolve = done;
    });
    vi.mocked(api).mockImplementation(async (url) =>
      url === "/api/genres" ? [] : response,
    );
    renderWithListenProviders(
      <EndpointPanel side="origin" selected={null} onSelect={vi.fn()} />,
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "coast" },
    });
    await elapse();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    await act(async () =>
      resolve({ artists: [{ id: 7, name: "Old result" }] }),
    );
    expect(screen.queryByRole("button", { name: "Old result" })).toBeNull();
    expect(screen.queryByTestId("loading-state")).toBeNull();
  });
  it("shows retry on a failed read and keeps a real empty response distinct", async () => {
    vi.mocked(api).mockRejectedValue(new Error("unavailable"));
    renderWithListenProviders(
      <EndpointPanel side="origin" selected={null} onSelect={vi.fn()} />,
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "coast" },
    });
    await elapse();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByTestId("empty-state")).toBeNull();
    vi.mocked(api).mockImplementation(async (url) =>
      url === "/api/genres" ? [] : { artists: [], albums: [], tracks: [] },
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await elapse();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
  });
});
