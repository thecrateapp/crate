import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";
import { ArtistNetworkGraph } from "./ArtistNetworkGraph";

interface GraphNode {
  id: string;
  in_library: boolean;
  score: number;
  artist_id?: number;
}
interface GraphProps {
  cooldownTicks: number;
  warmupTicks: number;
  onNodeClick: (node: GraphNode) => void;
  graphData: { nodes: GraphNode[]; links: unknown[] };
  linkColor: (link: { source: string; target: string }) => string;
}

const mocks = vi.hoisted(() => ({
  motion: true,
  api: vi.fn(),
  useApi: vi.fn(),
  graph: null as GraphProps | null,
}));

vi.mock("@/lib/api", () => ({ api: mocks.api }));
vi.mock("@/hooks/use-api", () => ({
  useApi: (url: string | null) => mocks.useApi(url),
}));
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
        {props.graphData.nodes.map((node) => (
          <button key={node.id} onClick={() => props.onNodeClick(node)}>
            Canvas {node.id}
          </button>
        ))}
      </>
    );
  },
}));

const BASE = {
  nodes: [
    { id: "Converge", group: 0, in_library: true, score: 1, artist_id: 7 },
    {
      id: "Botch",
      group: 1,
      in_library: true,
      score: 0.8,
      artist_id: 8,
      artist_slug: "botch",
    },
    { id: "Cave In", group: 1, in_library: false, score: 0.6 },
  ],
  links: [
    { source: "Converge", target: "Botch", value: 0.8 },
    { source: "Converge", target: "Cave In", value: 0.6 },
  ],
};

function graph() {
  return render(
    <MemoryRouter>
      <ArtistNetworkGraph centerArtist="Converge" centerArtistId={7} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.useApi.mockReset();
  mocks.motion = true;
  mocks.graph = null;
  document.documentElement.style.setProperty("--accent-action", "#06b6d4");
  document.documentElement.style.setProperty("--accent-action-hi", "#67e8f9");
  document.documentElement.style.setProperty("--color-border", "#292a30");
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(500);
  mocks.useApi.mockReturnValue({
    data: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
  mocks.api.mockImplementation((path: string) => {
    if (path.includes("artists-with-shows"))
      return Promise.resolve({ artists: ["Cave In"] });
    if (path.includes("depth=1"))
      return Promise.resolve({
        nodes: [
          { id: "Botch", group: 0, in_library: true, score: 1 },
          {
            id: "These Arms Are Snakes",
            group: 1,
            in_library: false,
            score: 0.7,
          },
          { id: "converge", group: 1, in_library: true, score: 0.8 },
        ],
        links: [
          { source: "Botch", target: "These Arms Are Snakes", value: 0.7 },
          { source: "Botch", target: "converge", value: 0.8 },
        ],
      });
    return Promise.resolve(BASE);
  });
});

it("loads the network route once and suppresses animated simulation for reduced motion", async () => {
  mocks.motion = false;
  graph();
  expect(await screen.findByTestId("network-motion")).toHaveTextContent(
    "0:200",
  );
  expect(
    mocks.api.mock.calls.filter(([path]) => path === "/api/artists/7/network"),
  ).toHaveLength(1);
});

it("opens on the center artist card with its connections", async () => {
  graph();
  const inspector = await screen.findByRole("region", {
    name: "Selected artist Converge",
  });
  expect(
    within(inspector).getByRole("heading", { name: "Converge" }),
  ).toBeInTheDocument();
  expect(
    within(inspector).getByRole("list", { name: "Connections of Converge" }),
  ).toHaveTextContent("Botch");
  expect(mocks.useApi).toHaveBeenLastCalledWith(
    "/api/network/artist-card?name=Converge",
  );
});

it("selects on canvas click without expanding, then expands on request", async () => {
  graph();
  await userEvent.click(
    await screen.findByRole("button", { name: "Canvas Botch" }),
  );

  const inspector = screen.getByRole("region", {
    name: "Selected artist Botch",
  });
  expect(
    within(inspector).getByText("80% similar to Converge", { exact: false }),
  ).toBeInTheDocument();
  expect(mocks.api).not.toHaveBeenCalledWith("/api/artists/8/network?depth=1");
  expect(
    mocks.graph!.linkColor({ source: "Converge", target: "Botch" }),
  ).not.toBe(mocks.graph!.linkColor({ source: "Converge", target: "Cave In" }));

  await userEvent.click(
    within(inspector).getByRole("button", { name: "Expand relations" }),
  );
  await waitFor(() =>
    expect(screen.getByTestId("network-nodes")).toHaveTextContent(
      "These Arms Are Snakes",
    ),
  );
  expect(mocks.api).toHaveBeenCalledWith("/api/artists/8/network?depth=1");
  expect(within(inspector).getByRole("status")).toHaveTextContent(
    "+1 artists added",
  );
  expect(mocks.graph!.graphData.nodes).toHaveLength(4);
  expect(
    within(inspector).getByRole("button", { name: "Expand relations" }),
  ).toBeDisabled();
});

it("says when an expansion finds nothing new", async () => {
  mocks.api.mockImplementation((path: string) => {
    if (path.includes("artists-with-shows"))
      return Promise.resolve({ artists: [] });
    if (path.includes("Cave+In") || path.includes("Cave%20In"))
      return Promise.resolve({
        nodes: [{ id: "Cave In", group: 0, in_library: true, score: 1 }],
        links: [],
      });
    return Promise.resolve(BASE);
  });
  graph();
  await userEvent.click(
    await screen.findByRole("button", { name: "Canvas Cave In" }),
  );
  const inspector = screen.getByRole("region", {
    name: "Selected artist Cave In",
  });
  expect(
    within(inspector).getByRole("link", { name: "Search to acquire" }),
  ).toHaveAttribute("href", "/download?q=Cave%20In");
  await userEvent.click(
    within(inspector).getByRole("button", { name: "Expand relations" }),
  );
  expect(await within(inspector).findByRole("status")).toHaveTextContent(
    "No new relations known",
  );
});

it("moves the selection with the keyboard and expands with Enter", async () => {
  graph();
  const stage = await screen.findByRole("listbox", { name: "Artist network" });
  stage.focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(screen.getByRole("option", { name: "Botch" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await userEvent.keyboard("{Enter}");
  await waitFor(() =>
    expect(mocks.api).toHaveBeenCalledWith("/api/artists/8/network?depth=1"),
  );
});

it("filters to missing artists while keeping the center and selection", async () => {
  graph();
  await screen.findByTestId("network-nodes");
  await userEvent.click(screen.getByRole("radio", { name: "Missing" }));
  expect(screen.getByTestId("network-nodes")).toHaveTextContent(
    "Converge, Cave In",
  );
  await userEvent.click(screen.getByRole("radio", { name: "With shows" }));
  expect(screen.getByTestId("network-nodes")).toHaveTextContent(
    "Converge, Cave In",
  );
});

it("recenters on an artist and goes back", async () => {
  graph();
  await userEvent.click(
    await screen.findByRole("button", { name: "Canvas Botch" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Center here" }));
  await waitFor(() =>
    expect(mocks.api).toHaveBeenCalledWith("/api/artists/8/network"),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Back to Converge" }),
  );
  await waitFor(() =>
    expect(
      mocks.api.mock.calls.filter(
        ([path]) => path === "/api/artists/7/network",
      ),
    ).toHaveLength(2),
  );
});

it("distinguishes an unavailable network and allows retry", async () => {
  mocks.api.mockImplementation((path: string) =>
    path.includes("artists-with-shows")
      ? Promise.resolve({ artists: [] })
      : Promise.reject(new Error("down")),
  );
  graph();
  expect(
    await screen.findByText("Artist network could not be loaded."),
  ).toBeInTheDocument();
  mocks.api.mockImplementation(() => Promise.resolve(BASE));
  await userEvent.click(screen.getByRole("button", { name: /retry/i }));
  expect(await screen.findByTestId("network-nodes")).toHaveTextContent(
    "Converge",
  );
});
