import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useApi: vi.fn(),
  api: vi.fn(),
  members: [] as unknown[],
  refetchMembers: vi.fn(),
}));

vi.mock("@/hooks/use-api", () => ({ useApi: mocks.useApi }));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: mocks.api };
});

import { CrateMembersModal } from "@/components/crates/CrateMembersModal";
import type { CrateDetail } from "@/pages/crates-types";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const crateId = "7ee76303-7aa6-4317-a5d3-18c2e1360b1c";

function crate(overrides: Partial<CrateDetail> = {}): CrateDetail {
  return {
    id: crateId,
    owner_id: 1,
    owner_name: "Listener",
    owner_username: "listener",
    name: "Year-end records",
    description: "",
    visibility: "public",
    is_collaborative: true,
    is_ordered: false,
    sort_direction: "asc",
    loop_enabled: false,
    access: "owner",
    album_count: 0,
    track_count: 0,
    first_album: null,
    albums: [],
    ...overrides,
  };
}

const ownerMember = {
  crate_id: crateId,
  user_id: 1,
  username: "listener",
  display_name: "Listener",
  role: "owner",
};
const collaboratorMember = {
  crate_id: crateId,
  user_id: 2,
  username: "jane",
  display_name: "Jane",
  role: "collaborator",
};

function renderModal(
  detail: CrateDetail,
  handlers: { onCrateChange?: () => void; onLeft?: () => void } = {},
  userId = 1,
) {
  return renderWithListenProviders(
    <CrateMembersModal
      crate={detail}
      open
      onClose={vi.fn()}
      onCrateChange={handlers.onCrateChange ?? vi.fn()}
      onLeft={handlers.onLeft ?? vi.fn()}
    />,
    {
      locale: "en",
      auth: {
        user: {
          id: userId,
          email: "u@example.test",
          name: userId === 1 ? "Listener" : "Jane",
          role: "user",
        },
      },
    },
  );
}

describe("CrateMembersModal", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.api.mockResolvedValue({ ok: true });
    mocks.useApi.mockClear();
    mocks.refetchMembers.mockReset();
    mocks.members = [ownerMember, collaboratorMember];
    mocks.useApi.mockImplementation((path: string | null) => ({
      data: path?.endsWith("/members") ? mocks.members : null,
      loading: false,
      error: null,
      refetch: mocks.refetchMembers,
    }));
  });

  it("lists the owner first and lets the owner remove collaborators", async () => {
    renderModal(crate());

    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Listener");
    expect(rows[0]).toHaveTextContent("Owner");
    expect(rows[1]).toHaveTextContent("Jane");
    expect(rows[1]).toHaveTextContent("Collaborator");
    expect(
      within(rows[0]!).queryByRole("button", { name: /Remove/ }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Remove Jane" }));

    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(
        `/api/crates/${crateId}/members/2`,
        "DELETE",
      ),
    );
    expect(mocks.refetchMembers).toHaveBeenCalled();
  });

  it("lets the owner add collaborators from people search", async () => {
    const onCrateChange = vi.fn();
    mocks.api.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith("/api/users/search")
          ? [
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
            ]
          : { ok: true },
      ),
    );
    renderModal(crate(), { onCrateChange });

    await userEvent.type(
      screen.getByRole("searchbox", {
        name: "Search people by name or username",
      }),
      "sa",
    );
    const add = await screen.findByRole("button", {
      name: "Add Sam as a collaborator",
    });
    expect(
      screen.queryByRole("button", { name: "Add Jane as a collaborator" }),
    ).toBeNull();
    fireEvent.click(add);

    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(
        `/api/crates/${crateId}/members`,
        "POST",
        { user_id: 3 },
      ),
    );
    expect(mocks.refetchMembers).toHaveBeenCalled();
    expect(onCrateChange).toHaveBeenCalled();
    expect(mocks.useApi).not.toHaveBeenCalledWith(
      `/api/crates/${crateId}/invites`,
    );
  });

  it("lets the owner turn on collaboration from the modal", async () => {
    const onCrateChange = vi.fn();
    mocks.members = [ownerMember];
    renderModal(crate({ is_collaborative: false }), { onCrateChange });

    fireEvent.click(
      screen.getByRole("button", { name: "Turn on collaboration" }),
    );

    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(`/api/crates/${crateId}`, "PUT", {
        is_collaborative: true,
      }),
    );
    expect(onCrateChange).toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Turn on collaboration" }),
      ).toBeNull(),
    );
  });

  it("resyncs the collaboration state when the Crate prop changes", () => {
    function Harness() {
      const [collaborative, setCollaborative] = useState(false);
      return (
        <>
          <button
            type="button"
            onClick={() => setCollaborative((value) => !value)}
          >
            toggle-prop
          </button>
          <CrateMembersModal
            crate={crate({ is_collaborative: collaborative })}
            open
            onClose={vi.fn()}
            onCrateChange={vi.fn()}
            onLeft={vi.fn()}
          />
        </>
      );
    }
    renderWithListenProviders(<Harness />, {
      auth: {
        user: {
          id: 1,
          email: "u@example.test",
          name: "Listener",
          role: "user",
        },
      },
    });
    const toggle = () =>
      fireEvent.click(
        screen.getByRole("button", { name: "toggle-prop", hidden: true }),
      );

    expect(
      screen.getByRole("button", { name: "Turn on collaboration" }),
    ).toBeVisible();

    toggle();
    expect(
      screen.queryByRole("button", { name: "Turn on collaboration" }),
    ).toBeNull();

    toggle();
    expect(
      screen.getByRole("button", { name: "Turn on collaboration" }),
    ).toBeVisible();
  });

  it("shows an error with retry when the members request fails", () => {
    mocks.useApi.mockImplementation((path: string | null) => ({
      data: null,
      loading: false,
      error: path?.endsWith("/members") ? new Error("boom") : null,
      refetch: mocks.refetchMembers,
    }));
    renderModal(crate());

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Could not load the collaborators.");
    expect(screen.queryByText("No collaborators yet.")).toBeNull();

    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(mocks.refetchMembers).toHaveBeenCalled();
  });

  it("shows collaborators a read-only list and lets them leave", async () => {
    const onLeft = vi.fn();
    renderModal(crate({ access: "collaborator" }), { onLeft }, 2);

    expect(screen.getAllByRole("listitem")[1]).toHaveTextContent("You");
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Create collaboration invite" }),
    ).toBeNull();
    expect(mocks.useApi).not.toHaveBeenCalledWith(
      `/api/crates/${crateId}/invites`,
    );

    fireEvent.click(screen.getByRole("button", { name: "Leave Crate" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));

    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(
        `/api/crates/${crateId}/members/2`,
        "DELETE",
      ),
    );
    expect(onLeft).toHaveBeenCalled();
  });
});
