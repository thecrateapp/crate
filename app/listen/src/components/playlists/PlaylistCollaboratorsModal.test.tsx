import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTranslation } from "react-i18next";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: mocks.api };
});

import { PlaylistCollaboratorsModal } from "@/components/playlists/PlaylistCollaboratorsModal";
import type { PlaylistData, PlaylistMember } from "@/pages/playlist-types";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const members: PlaylistMember[] = [
  {
    playlist_id: 42,
    user_id: 1,
    role: "owner",
    created_at: "2026-10-01T00:00:00Z",
    username: "owner",
    display_name: "Owner",
  },
  {
    playlist_id: 42,
    user_id: 2,
    role: "collab",
    created_at: "2026-10-01T00:00:00Z",
    username: "jane",
    display_name: "Jane",
  },
];

function playlist(access: PlaylistData["access"]): PlaylistData {
  return {
    id: 42,
    name: "Screamo",
    user_id: 1,
    access,
    visibility: "private",
    is_collaborative: true,
    is_smart: false,
    track_count: 0,
    total_duration: 0,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    tracks: [],
  };
}

function Harness(
  props: Omit<Parameters<typeof PlaylistCollaboratorsModal>[0], "t">,
) {
  const { t } = useTranslation();
  return <PlaylistCollaboratorsModal {...props} t={t} />;
}

function renderModal(
  access: PlaylistData["access"],
  handlers: { onAddMember?: () => Promise<void>; onLeave?: () => void } = {},
) {
  return renderWithListenProviders(
    <Harness
      open
      data={playlist(access)}
      members={members}
      user={null}
      leaving={false}
      removingMemberId={null}
      onAddMember={handlers.onAddMember ?? vi.fn(async () => {})}
      onClose={vi.fn()}
      onLeave={handlers.onLeave ?? vi.fn()}
      onRemoveMember={vi.fn()}
    />,
    { locale: "en" },
  );
}

describe("PlaylistCollaboratorsModal", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.api.mockResolvedValue([
      {
        id: 2,
        username: "jane",
        display_name: "Jane",
        avatar: null,
        bio: null,
        joined_at: "2026-01-01",
      },
      {
        id: 3,
        username: "sam",
        display_name: "Sam",
        avatar: null,
        bio: null,
        joined_at: "2026-01-01",
      },
    ]);
  });

  it("lets the owner add people who are not members yet", async () => {
    const onAddMember = vi.fn(async () => {});
    renderModal("owner", { onAddMember });

    await userEvent.type(
      screen.getByRole("searchbox", {
        name: "Search people by name or username",
      }),
      "s",
    );
    const add = await screen.findByRole("button", {
      name: "Add Sam as a collaborator",
    });
    expect(
      screen.queryByRole("button", { name: "Add Jane as a collaborator" }),
    ).toBeNull();
    fireEvent.click(add);

    await waitFor(() =>
      expect(onAddMember).toHaveBeenCalledWith(
        expect.objectContaining({ id: 3 }),
      ),
    );
    expect(screen.queryByRole("button", { name: "Leave playlist" })).toBeNull();
  });

  it("lets collaborators leave but not add people", async () => {
    const onLeave = vi.fn();
    renderModal("collaborator", { onLeave });

    expect(screen.queryByRole("searchbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Leave playlist" }));
    fireEvent.click(await screen.findByRole("button", { name: "Leave" }));

    expect(onLeave).toHaveBeenCalled();
  });
});
