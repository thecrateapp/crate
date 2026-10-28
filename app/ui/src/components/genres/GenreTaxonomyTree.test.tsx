import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useApiMock, apiMock, llmStatusMock } = vi.hoisted(() => ({
  useApiMock: vi.fn(),
  apiMock: vi.fn(),
  llmStatusMock: vi.fn(),
}));

vi.mock("@/hooks/use-api", () => ({
  useApi: useApiMock,
}));

vi.mock("@/hooks/use-task-poll", () => ({
  useTaskPoll: () => ({ pollTask: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
  ApiError: class extends Error {},
}));

vi.mock("@/hooks/use-llm", () => ({
  useActionLLMStatus: llmStatusMock,
}));

vi.mock("@/components/genres/GenreEqEditor", () => ({
  GenreEqEditor: (props: {
    aiProposalGains?: number[] | null;
    aiProposalReasoning?: string | null;
  }) => (
    <div
      data-testid="eq-editor"
      data-ai-gains={props.aiProposalGains?.join(",") ?? ""}
      data-ai-reasoning={props.aiProposalReasoning ?? ""}
    >
      EQ editor
    </div>
  ),
}));
vi.mock("@/components/ImageCropUpload", () => ({
  ImageCropUpload: ({ label }: { label: string }) => <button>{label}</button>,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { GenreTaxonomyTree } from "./GenreTaxonomyTree";

const taxonomyTree = {
  nodes: [
    {
      slug: "hardcore",
      name: "Hardcore",
      description: "Fast, direct, and loud.",
      cover_url: "/api/genres/hardcore/cover?size=640&format=webp",
      musicbrainz_mbid: "hardcore-mbid",
      wikidata_url: null,
      top_level: true,
      parent_slugs: [],
      children_slugs: [],
      related_slugs: ["punk"],
      influenced_by_slugs: [],
      influences_slugs: ["punk"],
      fusion_of_slugs: [],
      fusion_genre_slugs: [],
      alias_names: ["hardcore-punk"],
      artist_count: 12,
      album_count: 34,
      eq_gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      eq_preset_source: "direct",
      eq_preset_inherited_from: null,
    },
    {
      slug: "punk",
      name: "Punk",
      description: null,
      cover_url: null,
      musicbrainz_mbid: null,
      wikidata_url: null,
      top_level: true,
      parent_slugs: [],
      children_slugs: [],
      related_slugs: [],
      influenced_by_slugs: [],
      influences_slugs: [],
      fusion_of_slugs: [],
      fusion_genre_slugs: [],
      alias_names: [],
      artist_count: 0,
      album_count: 0,
      eq_gains: null,
      eq_preset_source: null,
      eq_preset_inherited_from: null,
    },
  ],
  top_level_slugs: ["hardcore", "punk"],
};

function renderTree(
  props: Partial<ComponentProps<typeof GenreTaxonomyTree>> = {},
) {
  return render(
    <MemoryRouter>
      <GenreTaxonomyTree {...props} />
    </MemoryRouter>,
  );
}

describe("GenreTaxonomyTree", () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockResolvedValue({});
    llmStatusMock.mockReset();
    llmStatusMock.mockReturnValue(null);
    useApiMock.mockReturnValue({
      data: taxonomyTree,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("keeps expansion accessible and separate from genre selection", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    renderTree({
      taxonomyData: {
        ...taxonomyTree,
        nodes: taxonomyTree.nodes.map((node) =>
          node.slug === "hardcore"
            ? { ...node, children_slugs: ["punk"] }
            : node,
        ),
        top_level_slugs: ["hardcore"],
      },
      onSelectionChange,
      showDetailPanel: false,
    });
    const expand = screen.getByRole("button", { name: "Expand Hardcore" });
    expect(expand).toHaveClass("size-11");
    expect(expand).toHaveAttribute("aria-expanded", "false");
    const children = document.getElementById(
      expand.getAttribute("aria-controls")!,
    );
    expect(children).not.toBeVisible();
    expand.focus();
    await user.keyboard("{Enter}");
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Collapse Hardcore" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(children).toBeVisible();
    await user.click(screen.getByText("Punk"));
    expect(onSelectionChange).toHaveBeenCalledWith("punk");
  });

  it("renders genre tree names as white monospaced labels", () => {
    renderTree({ showDetailPanel: false });

    expect(screen.getByText("Hardcore")).toHaveClass(
      "crate-mono-label",
      "font-mono",
      "uppercase",
      "text-white",
    );
  });

  it("keeps unselected taxonomy rows without hover fill or an accent border", () => {
    renderTree({ showDetailPanel: false });

    const label = screen.getByText("Hardcore");
    const row = label.closest(".group");

    expect(row).not.toHaveClass("hover:bg-[var(--hover-bg)]");
    expect(row).toHaveClass("border-white/6");
    expect(row).not.toHaveClass("hover:border-accent-action");
    expect(label).toHaveClass("group-hover:text-accent-action-hi");
    fireEvent.click(label);
    expect(row).toHaveClass("border-accent-action/40", "bg-accent-action/10");
  });

  it("hides curator actions and EQ editor for read-only users", () => {
    renderTree();

    fireEvent.click(screen.getByText("Hardcore"));

    expect(screen.queryByText("Sync MusicBrainz")).not.toBeInTheDocument();
    expect(screen.queryByText("Infer taxonomy")).not.toBeInTheDocument();
    expect(screen.queryByText("Generate playlist")).not.toBeInTheDocument();
    expect(screen.queryByText("EQ editor")).not.toBeInTheDocument();
    expect(screen.queryByText("Full detail page")).not.toBeInTheDocument();
  });

  it("keeps the detail panel sticky below the fixed app header", () => {
    renderTree();
    fireEvent.click(screen.getByText("Hardcore"));
    const panel = screen
      .getByRole("heading", { name: "Hardcore" })
      .closest(".sticky");
    expect(panel).not.toBeNull();
    expect(panel).toHaveClass("top-[calc(var(--app-header-h,0px)+1.5rem)]");
    expect(panel).not.toHaveClass("top-6");
  });

  it("supports controlled selection as a navigation tree without details", () => {
    const onSelectionChange = vi.fn();
    renderTree({
      taxonomyData: taxonomyTree,
      selectedSlug: null,
      onSelectionChange,
      showDetailPanel: false,
    });

    fireEvent.click(screen.getByText("Hardcore"));

    expect(onSelectionChange).toHaveBeenCalledWith("hardcore");
    expect(screen.queryByText("Full detail page")).not.toBeInTheDocument();
    expect(useApiMock).toHaveBeenCalledWith(null);
  });

  it("groups node management and keeps global maintenance actions out of the node panel", async () => {
    renderTree({ canCurate: true, canCreatePlaylists: true });

    fireEvent.click(screen.getByText("Hardcore"));

    expect(
      screen.getByRole("heading", { name: "Editorial Data" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "EQ Preset" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Relationships" }),
    ).toBeVisible();
    expect(screen.getByText("Cover image")).toBeVisible();
    expect(screen.getByText("Cover image")).toHaveClass(
      "font-mono",
      "text-text-subtle",
      "uppercase",
    );
    expect(screen.getByText("Description")).toHaveClass(
      "font-mono",
      "text-text-subtle",
      "uppercase",
    );
    expect(screen.getByText("Cover image")).toHaveClass("text-label");
    expect(screen.getByText("Description").parentElement).toHaveClass(
      "text-label",
      "leading-[1.4]",
      "tracking-caps",
    );
    expect(screen.getByText("Top-level genre")).toHaveClass(
      "font-mono",
      "text-text-subtle",
      "uppercase",
    );
    expect(
      screen.getByRole("region", { name: "Influences relationships" }),
    ).toHaveTextContent("punk");
    expect(
      screen.getByRole("region", { name: "Influences relationships" }),
    ).toHaveTextContent("Derived reverse view");
    expect(screen.queryByText("Sync MusicBrainz")).not.toBeInTheDocument();
    expect(screen.queryByText("Infer taxonomy")).not.toBeInTheDocument();
    expect(screen.queryByText("Clean invalid")).not.toBeInTheDocument();
    expect(screen.queryByText("Genre actions")).not.toBeInTheDocument();
    expect(screen.getByText("EQ editor")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Enrich with AI" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Checking AI model availability."),
    ).not.toBeInTheDocument();
    const nodeHeader = screen.getByRole("heading", { name: "Hardcore" })
      .parentElement?.parentElement;
    expect(nodeHeader).toHaveAttribute("data-slot", "genre-node-header");
    const generatePlaylist = within(nodeHeader as HTMLElement).getByRole(
      "button",
      { name: "Generate playlist" },
    );
    expect(generatePlaylist).toBeVisible();
    expect(generatePlaylist).toHaveAttribute("data-size", "icon-lg");
    expect(generatePlaylist.textContent).toBe("");
    expect(generatePlaylist.querySelector("svg")).toBeInTheDocument();
    expect(generatePlaylist).not.toHaveAttribute("title");
    await userEvent.hover(generatePlaylist);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Generate playlist",
    );
    const copyMbid = screen.getByRole("button", { name: "Copy MBID" });
    expect(copyMbid).not.toHaveAttribute("title");
    await userEvent.hover(copyMbid);
    expect(
      await screen.findByRole("tooltip", { name: "Copy MBID" }),
    ).toBeVisible();
    const saveMetadata = within(nodeHeader as HTMLElement).getByRole("button", {
      name: "Save genre metadata",
    });
    expect(saveMetadata).toBeVisible();
    expect(saveMetadata).toHaveAttribute("data-size", "icon-lg");
    expect(saveMetadata.textContent).toBe("");
    expect(saveMetadata.querySelector("svg")).toBeInTheDocument();
    const deleteGenre = within(nodeHeader as HTMLElement).getByRole("button", {
      name: "Delete genre",
    });
    expect(deleteGenre).toBeVisible();
    expect(deleteGenre).toHaveClass("text-state-danger", "rounded-full");
    expect(deleteGenre).not.toHaveClass("bg-state-danger/10");
    expect(deleteGenre.textContent).toBe("");
    expect(deleteGenre.querySelector("svg")).toBeInTheDocument();
    expect(deleteGenre).not.toHaveAttribute("title");
    await userEvent.hover(deleteGenre);
    expect(
      await screen.findByRole("tooltip", { name: "Delete genre" }),
    ).toBeVisible();
    expect(screen.getByText("References")).toHaveClass("text-accent-action-hi");
    expect(screen.getByText("Aliases · 1")).toHaveClass(
      "text-accent-action-hi",
    );
    expect(
      screen.getByText("hardcore-punk").closest("[data-slot='chip']"),
    ).toHaveClass("genre-pill");
    expect(
      screen.getByRole("button", { name: "Save relationships" }),
    ).toBeDisabled();
    expect(
      screen.getAllByRole("button", { name: "Save genre metadata" }),
    ).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Remove punk" }));
    const saveRelationships = screen.getByRole("button", {
      name: "Save relationships",
    });
    expect(saveRelationships).toBeEnabled();
    fireEvent.click(saveRelationships);
    expect(apiMock).toHaveBeenCalledWith(
      "/api/genres/taxonomy/hardcore/relations",
      "PUT",
      { relation_type: "related", target_slugs: [] },
    );
  });

  it("renders the selected genre editor into the explorer's detail slot", () => {
    const detailHost = document.createElement("div");
    document.body.append(detailHost);
    try {
      renderTree({
        taxonomyData: taxonomyTree,
        canCurate: true,
        detailPortalTarget: detailHost,
        showDetailPanel: false,
      });

      fireEvent.click(screen.getByText("Hardcore"));

      expect(detailHost).toHaveTextContent("EQ editor");
      expect(
        detailHost.querySelector<HTMLTextAreaElement>("#genre-description")
          ?.value,
      ).toBe("Fast, direct, and loud.");
      expect(
        detailHost.querySelector('img[alt="Hardcore genre cover"]'),
      ).toHaveAttribute(
        "src",
        "/api/genres/hardcore/cover?size=640&format=webp&v=0",
      );
      expect(detailHost).toHaveTextContent("Edit cover");
    } finally {
      detailHost.remove();
    }
  });

  it("stages description, relations and EQ from one enrichment call", async () => {
    llmStatusMock.mockReturnValue({ available: true });
    const eqGains = [1, 2, 1, 0, -1, 0, 1, 2, 1, 0];
    apiMock.mockResolvedValueOnce({
      description: "A forceful hardcore offshoot with metallic riffs.",
      aliases: [],
      relations: [
        {
          relation_type: "parent",
          target_slugs: ["punk"],
          confidence: 0.91,
          reasoning: "The local scene lineage supports this parent.",
        },
      ],
      eq_gains: eqGains,
      eq_reasoning: "Shape the low mids and add presence.",
      reasoning: "The local catalog points to punk lineage.",
    });
    renderTree({ canCurate: true });
    fireEvent.click(screen.getByText("Hardcore"));

    const nodeHeader = screen.getByRole("heading", { name: "Hardcore" })
      .parentElement?.parentElement;
    const enrichButton = within(nodeHeader as HTMLElement).getByRole("button", {
      name: "Enrich with AI",
    });
    expect(enrichButton).toHaveClass("text-accent-action", "rounded-full");
    expect(enrichButton).not.toHaveClass("bg-accent-action");
    expect(enrichButton.textContent).toBe("");
    expect(enrichButton.querySelector("svg")).toBeInTheDocument();
    expect(enrichButton).not.toHaveAttribute("title");
    await userEvent.hover(enrichButton);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Enrich with AI",
    );
    expect(screen.queryByText("Genre actions")).not.toBeInTheDocument();
    fireEvent.click(enrichButton);

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/api/genres/taxonomy/hardcore/proposal",
        "POST",
      ),
    );
    expect(
      document.querySelector<HTMLTextAreaElement>("#genre-description")?.value,
    ).toBe("A forceful hardcore offshoot with metallic riffs.");
    expect(screen.getByTestId("eq-editor")).toHaveAttribute(
      "data-ai-gains",
      eqGains.join(","),
    );
    expect(screen.getByTestId("eq-editor")).toHaveAttribute(
      "data-ai-reasoning",
      "Shape the low mids and add presence.",
    );
    expect(
      screen.getByText(/10-band EQ curve are staged for review/),
    ).toBeVisible();
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  async function stageHardcoreProposal() {
    llmStatusMock.mockReturnValue({ available: true });
    apiMock.mockResolvedValueOnce({
      description: "A forceful hardcore offshoot with metallic riffs.",
      aliases: ["hc"],
      relations: [
        {
          relation_type: "parent",
          target_slugs: ["punk"],
          confidence: 0.91,
          reasoning: "The local scene lineage supports this parent.",
        },
      ],
      eq_gains: [1, 2, 1, 0, -1, 0, 1, 2, 1, 0],
      eq_reasoning: "Shape the low mids and add presence.",
      reasoning: "The local catalog points to punk lineage.",
    });
    renderTree({ canCurate: true });
    fireEvent.click(screen.getByText("Hardcore"));
    fireEvent.click(screen.getByRole("button", { name: "Enrich with AI" }));
    await screen.findByText("Enrichment proposal ready to review");
  }

  it("applies every staged part of the AI proposal at once", async () => {
    await stageHardcoreProposal();

    fireEvent.click(screen.getByRole("button", { name: "Apply proposal" }));

    await waitFor(() =>
      expect(
        screen.queryByText("Enrichment proposal ready to review"),
      ).not.toBeInTheDocument(),
    );
    expect(apiMock).toHaveBeenCalledWith(
      "/api/genres/taxonomy/hardcore",
      "PATCH",
      {
        description: "A forceful hardcore offshoot with metallic riffs.",
        top_level: true,
      },
    );
    expect(apiMock).toHaveBeenCalledWith(
      "/api/genres/taxonomy/hardcore/relations",
      "PUT",
      { relation_type: "parent", target_slugs: ["punk"] },
    );
    expect(apiMock).toHaveBeenCalledWith(
      "/api/genres/taxonomy/hardcore/aliases",
      "PUT",
      { alias_names: ["hc"] },
    );
    expect(apiMock).toHaveBeenCalledWith(
      "/api/genres/hardcore/eq-preset",
      "PATCH",
      { gains: [1, 2, 1, 0, -1, 0, 1, 2, 1, 0] },
    );
    expect(screen.getByTestId("eq-editor")).toHaveAttribute(
      "data-ai-gains",
      "",
    );
  });

  it("keeps the proposal and names the parts that failed to apply", async () => {
    await stageHardcoreProposal();
    apiMock.mockImplementation((path: string) =>
      path.endsWith("/eq-preset")
        ? Promise.reject(new Error("offline"))
        : Promise.resolve({}),
    );

    fireEvent.click(screen.getByRole("button", { name: "Apply proposal" }));

    const { toast } = await import("sonner");
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Could not apply: EQ curve"),
    );
    expect(
      screen.getByText("Enrichment proposal ready to review"),
    ).toBeInTheDocument();
  });

  it("discards the proposal and restores the saved values", async () => {
    await stageHardcoreProposal();
    const calls = apiMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(
      screen.queryByText("Enrichment proposal ready to review"),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector<HTMLTextAreaElement>("#genre-description")?.value,
    ).toBe("Fast, direct, and loud.");
    expect(screen.getByTestId("eq-editor")).toHaveAttribute(
      "data-ai-gains",
      "",
    );
    expect(apiMock.mock.calls.length).toBe(calls);
  });

  it("stops highlighting a staged section once that section is saved", async () => {
    await stageHardcoreProposal();
    expect(screen.getByText(/AI 91%/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save relationships" }));

    await waitFor(() =>
      expect(screen.queryByText(/AI 91%/)).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText("Enrichment proposal ready to review"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Save editorial data" }),
    );

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/api/genres/taxonomy/hardcore",
        "PATCH",
        {
          description: "A forceful hardcore offshoot with metallic riffs.",
          top_level: true,
        },
      ),
    );
  });

  it("preserves dirty metadata and relationships while refreshing clean fields of the same genre", async () => {
    const freshTree = {
      ...taxonomyTree,
      nodes: taxonomyTree.nodes.map((node) =>
        node.slug === "hardcore"
          ? {
              ...node,
              description: "Server refreshed description",
              parent_slugs: ["punk"],
              artist_count: 13,
            }
          : node,
      ),
    };
    const view = renderTree({ taxonomyData: taxonomyTree, canCurate: true });
    fireEvent.click(screen.getByText("Hardcore"));
    const description = screen.getByRole("textbox", { name: "Description" });
    fireEvent.change(description, {
      target: { value: "Unsaved editorial description" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Top-level genre" }));
    const related = screen
      .getByRole("textbox", { name: "Search related" })
      .closest("section") as HTMLElement;
    fireEvent.click(
      within(related).getByRole("button", { name: "Remove punk" }),
    );
    view.rerender(
      <MemoryRouter>
        <GenreTaxonomyTree taxonomyData={freshTree} canCurate />
      </MemoryRouter>,
    );
    expect(description).toHaveValue("Unsaved editorial description");
    expect(
      screen.getByRole("checkbox", { name: "Top-level genre" }),
    ).not.toBeChecked();
    expect(
      within(
        screen
          .getByRole("textbox", { name: "Search parents" })
          .closest("section") as HTMLElement,
      ).getByRole("button", { name: "Remove punk" }),
    ).toBeVisible();
    expect(
      within(related).queryByRole("button", { name: "Remove punk" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save relationships" }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/api/genres/taxonomy/hardcore/relations",
        "PUT",
        { relation_type: "related", target_slugs: [] },
      ),
    );
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it("loads fresh values for a clean genre and resets drafts when selecting a different genre", () => {
    const view = renderTree({ taxonomyData: taxonomyTree, canCurate: true });
    fireEvent.click(screen.getByText("Hardcore"));
    view.rerender(
      <MemoryRouter>
        <GenreTaxonomyTree
          taxonomyData={{
            ...taxonomyTree,
            nodes: taxonomyTree.nodes.map((node) =>
              node.slug === "hardcore"
                ? { ...node, description: "Fresh clean value" }
                : node,
            ),
          }}
          canCurate
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue(
      "Fresh clean value",
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
      target: { value: "Hardcore dirty draft" },
    });
    fireEvent.click(screen.getByText("Punk", { selector: "span" }));
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue(
      "",
    );
  });
  it("retains delete confirmation on failure and lets the same genre be retried", async () => {
    const user = userEvent.setup();
    let reject!: (reason: Error) => void;
    const pending = new Promise<unknown>((_resolve, fail) => {
      reject = fail;
    });
    apiMock.mockReturnValueOnce(pending).mockResolvedValue({
      ok: true,
      removed_artist_assignments: 0,
      removed_album_assignments: 0,
    });
    renderTree({ taxonomyData: taxonomyTree, canCurate: true });
    fireEvent.click(screen.getByText("Hardcore"));
    await user.click(screen.getByRole("button", { name: "Delete genre" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", {
      name: "Delete Genre",
    });
    await user.click(confirm);
    expect(confirm).toBeDisabled();
    expect(dialog).toBeInTheDocument();
    await act(async () => {
      reject(new Error("temporary"));
      await pending.catch(() => {});
    });
    expect(confirm).toBeEnabled();
    expect(dialog).toBeInTheDocument();
    await user.click(confirm);
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  });

  it("does not clear a different genre selection when an earlier deletion completes", async () => {
    const selection = vi.fn();
    let resolve!: (result: unknown) => void;
    const pending = new Promise((done) => {
      resolve = done;
    });
    apiMock.mockReturnValue(pending);
    const view = renderTree({
      taxonomyData: taxonomyTree,
      canCurate: true,
      selectedSlug: "hardcore",
      onSelectionChange: selection,
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete genre" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Delete Genre",
      }),
    );
    view.rerender(
      <MemoryRouter>
        <GenreTaxonomyTree
          taxonomyData={taxonomyTree}
          canCurate
          selectedSlug="punk"
          onSelectionChange={selection}
        />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
      target: { value: "Punk draft" },
    });
    await act(async () => {
      resolve({
        ok: true,
        removed_artist_assignments: 0,
        removed_album_assignments: 0,
      });
      await pending;
    });
    expect(selection).not.toHaveBeenCalledWith(null);
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue(
      "Punk draft",
    );
  });
});
