import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";
import { ArtistNetworkGraph } from "./ArtistNetworkGraph";
const mocks = vi.hoisted(() => ({ motion: true, api: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: mocks.api }));
vi.mock("@crate/ui/lib/motion-gate", () => ({
  useMotionAllowed: () => mocks.motion,
}));
vi.mock("react-force-graph-2d", () => ({
  default: ({
    cooldownTicks,
    warmupTicks,
    onNodeClick,
    graphData,
  }: {
    cooldownTicks: number;
    warmupTicks: number;
    onNodeClick: (node: unknown) => void;
    graphData: { nodes: unknown[] };
  }) => (
    <>
      <output data-testid="network-motion">
        {cooldownTicks}:{warmupTicks}
      </output>
      <button onClick={() => onNodeClick(graphData.nodes[1])}>
        Select graph artist
      </button>
    </>
  ),
}));
beforeEach(() => {
  mocks.api.mockReset();
  mocks.motion = true;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(500);
  mocks.api.mockImplementation((path: string) =>
    Promise.resolve(
      path.includes("artists-with-shows")
        ? { artists: [] }
        : {
            nodes: [
              { id: "Converge", group: 1, in_library: true, score: 1 },
              {
                id: "Botch",
                group: 1,
                in_library: true,
                score: 0.8,
                artist_id: 8,
                artist_slug: "botch",
              },
            ],
            links: [{ source: "Converge", target: "Botch", value: 0.8 }],
          },
    ),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: (entries: unknown[]) => void) {}
      observe() {
        this.callback([{ contentRect: { width: 500 } }]);
      }
      disconnect() {}
    },
  );
});
it("keeps the network data route while suppressing animated simulation for reduced motion", async () => {
  const { rerender } = render(
    <MemoryRouter>
      <ArtistNetworkGraph centerArtist="Converge" centerArtistId={7} />
    </MemoryRouter>,
  );
  expect(await screen.findByTestId("network-motion")).toHaveTextContent(
    "200:50",
  );
  expect(mocks.api).toHaveBeenCalledWith("/api/artists/7/network");
  mocks.motion = false;
  rerender(
    <MemoryRouter>
      <ArtistNetworkGraph centerArtist="Converge" centerArtistId={7} />
    </MemoryRouter>,
  );
  expect(screen.getByTestId("network-motion")).toHaveTextContent("0:200");
});

it("offers native navigation and keyboard expansion outside the canvas", async () => {
  render(
    <MemoryRouter>
      <ArtistNetworkGraph centerArtist="Converge" centerArtistId={7} />
    </MemoryRouter>,
  );
  expect(
    await screen.findByRole("link", { name: "Open Botch" }),
  ).toHaveAttribute("href", "/artists/botch");
  const expand = screen.getByRole("button", { name: "Expand Botch" });
  act(() => expand.focus());
  await userEvent.keyboard("{Enter}");
  expect(mocks.api).toHaveBeenCalledWith("/api/artists/8/network?depth=1");
});
it("distinguishes an unavailable network and allows retry", async () => {
  mocks.api.mockImplementation((path: string) =>
    path.includes("artists-with-shows")
      ? Promise.resolve({ artists: [] })
      : Promise.reject(new Error("offline")),
  );
  render(
    <MemoryRouter>
      <ArtistNetworkGraph centerArtist="Converge" centerArtistId={7} />
    </MemoryRouter>,
  );
  await screen.findByRole("button", { name: "Retry" });
  expect(
    screen.queryByText(/No similarity data available/),
  ).not.toBeInTheDocument();
});

it("exposes named actions for a node selected on the canvas", async () => {
  render(
    <MemoryRouter>
      <ArtistNetworkGraph centerArtist="Converge" centerArtistId={7} />
    </MemoryRouter>,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Select graph artist" }),
  );
  expect(
    screen.getByRole("link", { name: "Open selected artist Botch" }),
  ).toHaveAttribute("href", "/artists/botch");
  expect(
    screen.getByRole("button", { name: "Expand selected artist Botch" }),
  ).toBeEnabled();
});
