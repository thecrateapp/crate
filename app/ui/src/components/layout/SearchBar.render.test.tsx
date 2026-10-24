import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchBar } from "./SearchBar";
import { api } from "@/lib/api";
vi.mock("@/lib/api", () => ({ api: vi.fn() }));
const result = {
  artists: [{ name: "Costa Norte", slug: "costa-norte" }],
  albums: [{ artist: "Costa Norte", name: "Octubre", slug: "octubre" }],
  tracks: [{ title: "Luz", artist: "Costa Norte", album: "Octubre" }],
};
function Route() {
  const location = useLocation();
  return <output aria-label="Route">{location.pathname}</output>;
}
function setup() {
  const ref = createRef<HTMLInputElement>();
  render(
    <MemoryRouter>
      <SearchBar inputRef={ref} />
      <Route />
    </MemoryRouter>,
  );
  return screen.getByRole("textbox", { name: "Search library" });
}
async function tick(ms = 200) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.mocked(api).mockReset();
  vi.mocked(api).mockResolvedValue(result);
});
afterEach(() => vi.useRealTimers());
describe("Admin search presentation and interactions", () => {
  it("keeps named result types and keyboard routes without placeholder icons", async () => {
    const input = setup();
    fireEvent.change(input, { target: { value: "luz" } });
    await tick(199);
    expect(api).not.toHaveBeenCalled();
    await tick(1);
    const popup = screen.getByRole("region", {
      name: "Library search suggestions",
    });
    expect(screen.getByLabelText("Route").parentElement!.contains(popup)).toBe(
      false,
    );
    expect(input).toHaveValue("luz");
    const artist = screen.getByRole("button", {
      name: /Costa Norte Artist artist/,
    });
    const album = screen.getByRole("button", {
      name: /Octubre Costa Norte album/,
    });
    const track = screen.getByRole("button", {
      name: /Luz Costa Norte — Octubre track/,
    });
    expect(screen.getByText("In Library")).toHaveClass("crate-mono-label");
    for (const row of [artist, album, track]) {
      expect(row.querySelector("svg")).toBeNull();
      expect(row).toHaveClass("hover:text-accent-action-hi", "border-l-2");
    }
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByLabelText("Route")).toHaveTextContent(
      "/artists/costa-norte/octubre",
    );
    expect(input).toHaveValue("");
    expect(JSON.parse(localStorage.getItem("search-recents:v1")!)).toEqual([
      "luz",
    ]);
  });
  it("keeps recent queries as text, keyboard selection, cache and immediate clear", async () => {
    localStorage.setItem("search-recents:v1", JSON.stringify(["Costa"]));
    const input = setup();
    fireEvent.focus(input);
    const recent = screen.getByRole("button", { name: "Costa" });
    expect(recent.querySelector("svg")).toBeNull();
    expect(screen.getByText("Recent")).toHaveClass("crate-mono-label");
    expect(recent).toHaveClass("hover:text-accent-action-hi");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    await tick();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "costa" } });
    await tick();
    expect(api).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByText("In Library")).not.toBeInTheDocument();
  });
  it("keeps loading feedback as UX and reports a text-only empty result", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(api).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }) as ReturnType<typeof api>,
    );
    const input = setup();
    fireEvent.change(input, { target: { value: "none" } });
    await tick();
    expect(input).toHaveAttribute("aria-busy", "true");
    expect(
      document.querySelector('[data-admin-ux="search-loading"]'),
    ).toHaveAttribute("aria-hidden", "true");
    await act(async () => {
      resolve({ artists: [], albums: [], tracks: [] });
    });
    expect(input).not.toHaveAttribute("aria-busy", "true");
    const empty = screen.getByText("No library matches");
    expect(empty.querySelector("svg")).toBeNull();
    expect(empty.parentElement!.querySelector("svg")).toBeNull();
  });
  it("preserves real artwork as content", async () => {
    vi.mocked(api).mockResolvedValue({
      ...result,
      artists: [{ id: 7, name: "Costa Norte" }],
    });
    const input = setup();
    fireEvent.change(input, { target: { value: "Costa" } });
    await tick();
    expect(
      screen
        .getByRole("button", { name: /Costa Norte Artist artist/ })
        .querySelector("img"),
    ).toHaveAttribute("src", expect.stringContaining("/api/artists/7/photo"));
  });
});

it("notifies its modal owner only after choosing a result and keeps concurrent field IDs unique", async () => {
  const selected = vi.fn();
  render(
    <MemoryRouter>
      <SearchBar onNavigate={selected} />
      <SearchBar />
    </MemoryRouter>,
  );
  const fields = screen.getAllByRole("textbox", { name: "Search library" });
  expect(fields[0]!.id).not.toBe(fields[1]!.id);
  expect(selected).not.toHaveBeenCalled();
  fireEvent.change(fields[0]!, { target: { value: "luz" } });
  await tick();
  expect(selected).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: /Costa Norte Artist artist/ }),
  );
  expect(selected).toHaveBeenCalledOnce();
});
