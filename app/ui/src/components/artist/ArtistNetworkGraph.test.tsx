import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";
import { ArtistNetworkGraph } from "./ArtistNetworkGraph";
interface GraphNode {
  id: string;
  group: number;
  in_library: boolean;
  score: number;
  artist_id?: number;
  artist_slug?: string;
}
interface GraphProps {
  cooldownTicks: number;
  warmupTicks: number;
  onNodeClick: (node: GraphNode) => void;
  graphData: { nodes: GraphNode[]; links: unknown[] };
  nodeCanvasObject: (
    node: GraphNode,
    context: CanvasRenderingContext2D,
    scale: number,
  ) => void;
  linkColor: (link: {
    source: string | GraphNode;
    target: string | GraphNode;
  }) => string;
}
const mocks = vi.hoisted(() => ({
  motion: true,
  api: vi.fn(),
  graph: null as GraphProps | null,
}));
vi.mock("@/lib/api", () => ({ api: mocks.api }));
vi.mock("@crate/ui/lib/motion-gate", () => ({
  useMotionAllowed: () => mocks.motion,
}));
vi.mock("react-force-graph-2d", () => ({
  default: (props: GraphProps) => {
    mocks.graph = props;
    return (
      <>
        <output data-testid="network-motion">
          {props.cooldownTicks}:{props.warmupTicks}
        </output>
        <output data-testid="network-nodes">
          {props.graphData.nodes.map((node) => node.id).join(", ")}
        </output>
        <button onClick={() => props.onNodeClick(props.graphData.nodes[1]!)}>
          Select graph artist
        </button>
      </>
    );
  },
}));
beforeEach(() => {
  mocks.api.mockReset();
  mocks.motion = true;
  mocks.graph = null;
  document.documentElement.style.setProperty("--accent-action", "#06b6d4");
  document.documentElement.style.setProperty("--surface-object", "#14151a");
  document.documentElement.style.setProperty("--color-border", "#292a30");
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

it("keeps node navigation and expansion on the keyboard without a visible artist list", async () => {
  render(
    <MemoryRouter>
      <ArtistNetworkGraph centerArtist="Converge" centerArtistId={7} />
    </MemoryRouter>,
  );
  const graph = await screen.findByRole("listbox", { name: "Artist network" });
  expect(
    screen.queryByRole("link", { name: "Open Botch" }),
  ).not.toBeInTheDocument();
  act(() => graph.focus());
  await userEvent.keyboard("{End}{Enter}");
  expect(mocks.api).toHaveBeenCalledWith("/api/artists/8/network?depth=1");
  expect(screen.getByRole("option", { name: "Botch" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(graph).toHaveAttribute(
    "aria-activedescendant",
    screen.getByRole("option", { name: "Botch" }).id,
  );
  expect(
    screen.getByRole("link", { name: "Open selected artist Botch" }),
  ).toHaveAttribute("href", "/artists/botch");
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

it("expands the artist directly on canvas selection and exposes its navigation action", async () => {
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
  await waitFor(() =>
    expect(mocks.api).toHaveBeenCalledWith("/api/artists/8/network?depth=1"),
  );
  expect(
    screen.getByRole("button", { name: "Expand selected artist Botch" }),
  ).toBeDisabled();
});

it("adds the clicked artist's neighbours once and highlights an external selection on the canvas", async () => {
  mocks.api.mockImplementation((path: string) =>
    Promise.resolve(
      path.includes("artists-with-shows")
        ? { artists: [] }
        : path.includes("depth=1")
          ? {
              nodes: [
                { id: "Botch", group: 1, in_library: false, score: 0.8 },
                { id: "Cave In", group: 2, in_library: false, score: 0.7 },
              ],
              links: [{ source: "Botch", target: "Cave In", value: 0.7 }],
            }
          : {
              nodes: [
                { id: "Converge", group: 1, in_library: true, score: 1 },
                { id: "Botch", group: 1, in_library: false, score: 0.8 },
              ],
              links: [{ source: "Converge", target: "Botch", value: 0.8 }],
            },
    ),
  );
  render(
    <MemoryRouter>
      <ArtistNetworkGraph centerArtist="Converge" centerArtistId={7} />
    </MemoryRouter>,
  );
  await screen.findByTestId("network-motion");
  const fills: string[] = [];
  const context = {
    beginPath: vi.fn(),
    arc: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    fill() {
      fills.push(this.fillStyle);
    },
    stroke: vi.fn(),
    fillText: vi.fn(),
    setLineDash: vi.fn(),
  };
  mocks.graph!.nodeCanvasObject(
    mocks.graph!.graphData.nodes[1]!,
    context as unknown as CanvasRenderingContext2D,
    1,
  );
  expect(fills).not.toContain("#06b6d4");
  await userEvent.click(
    screen.getByRole("button", { name: "Select graph artist" }),
  );
  await waitFor(() =>
    expect(screen.getByTestId("network-nodes")).toHaveTextContent("Cave In"),
  );
  fills.length = 0;
  mocks.graph!.nodeCanvasObject(
    mocks.graph!.graphData.nodes[1]!,
    context as unknown as CanvasRenderingContext2D,
    1,
  );
  expect(fills).toContain("#06b6d4");
  expect(mocks.graph!.linkColor({ source: "Converge", target: "Botch" })).toBe(
    "#06b6d4",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Select graph artist" }),
  );
  expect(
    mocks.api.mock.calls.filter(([path]) => String(path).includes("depth=1")),
  ).toHaveLength(1);
  expect(mocks.graph!.graphData.nodes).toHaveLength(3);
});

it("does not insert a selected-node toolbar or select another artist when the canvas receives focus", async () => {
  render(
    <MemoryRouter>
      <ArtistNetworkGraph centerArtist="Converge" centerArtistId={7} />
    </MemoryRouter>,
  );
  const graph = await screen.findByRole("listbox", { name: "Artist network" });
  act(() => graph.focus());
  expect(graph).not.toHaveAttribute("aria-activedescendant");
  expect(
    screen.queryByRole("group", { name: /^Actions for / }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Converge" })).toHaveAttribute(
    "aria-selected",
    "false",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Select graph artist" }),
  );
  expect(screen.getByRole("option", { name: "Botch" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("option", { name: "Converge" })).toHaveAttribute(
    "aria-selected",
    "false",
  );
  expect(mocks.api).toHaveBeenCalledWith("/api/artists/8/network?depth=1");
});
