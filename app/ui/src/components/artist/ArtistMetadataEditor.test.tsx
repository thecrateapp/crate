import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ArtistMetadataEditor } from "./ArtistMetadataEditor";

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
}));

vi.mock("@/lib/tasks", () => ({
  waitForTask: vi.fn(),
}));
vi.mock("@/hooks/use-llm", () => ({
  useActionLLMStatus: () => ({ available: true }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { api } from "@/lib/api";
import { waitForTask } from "@/lib/tasks";
import { toast } from "sonner";

const mockApi = vi.mocked(api);
const mockWaitForTask = vi.mocked(waitForTask);

const artist = {
  id: 12,
  entity_uid: "artist-uid",
  name: "High Vis",
  albums: [],
  total_tracks: 0,
  total_size_mb: 0,
  genre_profile: [],
  issue_count: 0,
  is_v2: true,
  bio: "Old bio",
  tags_json: ["post-punk"],
  urls_json: { official: "https://highvis.example" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.mockResolvedValue({ task_id: "task-1" });
  mockWaitForTask.mockResolvedValue({ status: "completed", result: {} });
});

describe("ArtistMetadataEditor", () => {
  it("queues artist metadata with canonical genres and urls", async () => {
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ArtistMetadataEditor
        open
        onOpenChange={onOpenChange}
        artist={artist}
        onSaved={onSaved}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /bio/i }), {
      target: { value: "New bio" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /external urls/i }), {
      target: {
        value:
          "official=https://highvis.example\nbandcamp=https://highvis.bandcamp.com",
      },
    });
    await userEvent.click(
      screen.getByRole("button", { name: /save metadata/i }),
    );

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
    expect(mockApi).toHaveBeenCalledWith(
      "/api/artists/by-entity/artist-uid/metadata",
      "PUT",
      expect.objectContaining({
        bio: "New bio",
        genres: [],
        urls: {
          official: "https://highvis.example",
          bandcamp: "https://highvis.bandcamp.com",
        },
      }),
    );
    expect(mockWaitForTask).toHaveBeenCalledWith("task-1", 60000);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
  it("reviews unsaved changes through the shared confirmation before closing", async () => {
    const onOpenChange = vi.fn();
    render(
      <ArtistMetadataEditor open onOpenChange={onOpenChange} artist={artist} />,
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: /bio/i }),
      " changed",
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("alertdialog", {
        name: "Discard artist metadata changes?",
      }),
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Discard changes" }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

const proposal =
  "High Vis is an English rock band. The group combines melody with a direct hardcore edge.";
function mockResearchAndSave() {
  mockApi.mockImplementation(async (_path, method) => ({
    task_id: method === "PUT" ? "save-bio" : "research-bio",
  }));
  mockWaitForTask.mockImplementation(async (id) =>
    id === "research-bio"
      ? {
          status: "completed",
          result: {
            bio_action: "update",
            bio: { paragraphs: [proposal] },
            sources: [],
          },
        }
      : { status: "completed", result: { changed_fields: ["bio"] } },
  );
}
async function openResearch() {
  await userEvent.click(
    screen.getByRole("button", { name: "Research with AI" }),
  );
  await screen.findByTestId("artist-bio-preview");
}

it("persists Apply biography before confirming success and retains it when the editor reopens", async () => {
  mockResearchAndSave();
  let completeSave!: (value: Awaited<ReturnType<typeof waitForTask>>) => void;
  const pendingSave = new Promise<Awaited<ReturnType<typeof waitForTask>>>(
    (resolve) => {
      completeSave = resolve;
    },
  );
  let storedBio = artist.bio;
  mockWaitForTask.mockImplementation((id) =>
    id === "save-bio"
      ? pendingSave.then((task) => {
          if (task.status === "completed") storedBio = proposal;
          return task;
        })
      : Promise.resolve({
          status: "completed",
          result: { bio: { paragraphs: [proposal] }, sources: [] },
        }),
  );
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  const { rerender } = render(
    <ArtistMetadataEditor
      open
      onOpenChange={onOpenChange}
      artist={artist}
      onSaved={onSaved}
    />,
  );
  await openResearch();
  await userEvent.click(
    screen.getByRole("button", { name: "Apply biography" }),
  );
  expect(mockApi).toHaveBeenCalledWith(
    "/api/artists/by-entity/artist-uid/metadata",
    "PUT",
    { bio: proposal },
  );
  expect(onSaved).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalledWith("Biography saved");
  expect(
    screen.getByRole("button", { name: "Apply biography" }),
  ).toBeDisabled();
  await act(async () => {
    completeSave({ status: "completed", result: { changed_fields: ["bio"] } });
  });
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(storedBio).toBe(proposal);
  expect(screen.getByRole("textbox", { name: "Biography" })).toHaveValue(
    proposal,
  );
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  rerender(
    <ArtistMetadataEditor
      open={false}
      onOpenChange={onOpenChange}
      artist={{ ...artist, bio: storedBio }}
      onSaved={onSaved}
    />,
  );
  rerender(
    <ArtistMetadataEditor
      open
      onOpenChange={onOpenChange}
      artist={{ ...artist, bio: storedBio }}
      onSaved={onSaved}
    />,
  );
  expect(screen.getByRole("textbox", { name: "Biography" })).toHaveValue(
    proposal,
  );
  expect(toast.success).toHaveBeenCalledWith("Biography saved");
});

it("preserves a dirty draft on a same-artist refetch and resets it for another artist", () => {
  const onOpenChange = vi.fn();
  const { rerender } = render(
    <ArtistMetadataEditor open onOpenChange={onOpenChange} artist={artist} />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Biography" }), {
    target: { value: "Unsaved draft" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "External URLs" }), {
    target: { value: "official=https://draft.example" },
  });
  rerender(
    <ArtistMetadataEditor
      open
      onOpenChange={onOpenChange}
      artist={{ ...artist, bio: "Refetched old bio" }}
    />,
  );
  expect(screen.getByRole("textbox", { name: "Biography" })).toHaveValue(
    "Unsaved draft",
  );
  expect(screen.getByRole("textbox", { name: "External URLs" })).toHaveValue(
    "official=https://draft.example",
  );
  rerender(
    <ArtistMetadataEditor
      open
      onOpenChange={onOpenChange}
      artist={{
        ...artist,
        id: 13,
        entity_uid: "another-artist",
        name: "Botch",
        bio: "Another biography",
      }}
    />,
  );
  expect(screen.getByRole("textbox", { name: "Biography" })).toHaveValue(
    "Another biography",
  );
});

it("saves only the AI biography while preserving other unsaved fields across refetch", async () => {
  mockResearchAndSave();
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  const { rerender } = render(
    <ArtistMetadataEditor
      open
      onOpenChange={onOpenChange}
      artist={artist}
      onSaved={onSaved}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "External URLs" }), {
    target: { value: "official=https://draft.example" },
  });
  await openResearch();
  await userEvent.click(
    screen.getByRole("button", { name: "Apply biography" }),
  );
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(mockApi).toHaveBeenCalledWith(
    "/api/artists/by-entity/artist-uid/metadata",
    "PUT",
    { bio: proposal },
  );
  rerender(
    <ArtistMetadataEditor
      open
      onOpenChange={onOpenChange}
      artist={{ ...artist, bio: proposal }}
      onSaved={onSaved}
    />,
  );
  expect(screen.getByRole("textbox", { name: "Biography" })).toHaveValue(
    proposal,
  );
  expect(screen.getByRole("textbox", { name: "External URLs" })).toHaveValue(
    "official=https://draft.example",
  );
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(
    screen.getByRole("alertdialog", {
      name: "Discard artist metadata changes?",
    }),
  ).toBeInTheDocument();
});

it("cancels biography research without saving or reporting that it was applied", async () => {
  mockResearchAndSave();
  const onSaved = vi.fn();
  render(
    <ArtistMetadataEditor
      open
      onOpenChange={vi.fn()}
      artist={artist}
      onSaved={onSaved}
    />,
  );
  await openResearch();
  const research = screen.getByRole("dialog", {
    name: "Research biography with AI",
  });
  await userEvent.click(
    within(research).getByRole("button", { name: "Cancel" }),
  );
  expect(
    mockApi.mock.calls.filter(([, method]) => method === "PUT"),
  ).toHaveLength(0);
  expect(onSaved).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "Biography" })).toHaveValue(
    "Old bio",
  );
});

it("keeps the proposal available and reports failure when biography persistence fails", async () => {
  mockResearchAndSave();
  mockWaitForTask.mockImplementation(async (id) =>
    id === "research-bio"
      ? {
          status: "completed",
          result: { bio: { paragraphs: [proposal] }, sources: [] },
        }
      : {
          status: "failed",
          error: "Worker could not save biography",
        },
  );
  const onSaved = vi.fn();
  render(
    <ArtistMetadataEditor
      open
      onOpenChange={vi.fn()}
      artist={artist}
      onSaved={onSaved}
    />,
  );
  await openResearch();
  await userEvent.click(
    screen.getByRole("button", { name: "Apply biography" }),
  );
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Worker could not save biography"),
  );
  expect(
    screen.getByRole("dialog", { name: "Research biography with AI" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Apply biography" })).toBeEnabled();
  expect(onSaved).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
});
