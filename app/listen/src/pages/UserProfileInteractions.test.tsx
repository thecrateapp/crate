import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { UserProfile } from "./UserProfile";
import type { PublicProfile } from "./user-profile-model";
vi.mock("@/hooks/use-api", () => ({ useApi: vi.fn() }));
vi.mock("@/lib/api", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api")>("@/lib/api")),
  api: vi.fn(),
}));
const profile: PublicProfile = {
  id: 7,
  username: "Jane",
  display_name: "Jane Doe",
  avatar: null,
  bio: "A public bio",
  joined_at: "2026-01-01",
  followers_count: 0,
  following_count: 0,
  friends_count: 0,
  public_playlists: [],
  public_crates: [],
  relationship_state: {
    following: false,
    followed_by: false,
    is_friend: false,
  },
  affinity_score: 0,
  affinity_band: "low",
  affinity_reasons: [],
  followers_preview: [],
  following_preview: [],
  top_genre: null,
  stats: {
    plays_30d: 0,
    minutes_30d: 0,
    contributions: 0,
    public_playlists: 0,
  },
  badges: [],
  contributions_preview: [],
};
const refetch = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useApi).mockReturnValue({
    data: profile,
    loading: false,
    error: null,
    refetch,
  });
});
it("uses the common View All action on both profile relationship sections", () => {
  renderWithListenProviders(<UserProfile />, {
    route: "/users/Jane",
    path: "/users/:username",
  });
  const links = screen.getAllByRole("link", { name: "View All" });
  expect(links.map((link) => link.getAttribute("href"))).toEqual([
    "/users/Jane/followers",
    "/users/Jane/following",
  ]);
  for (const link of links) {
    expect(within(link).getByText("View All")).toHaveClass(
      "font-mono",
      "uppercase",
      "text-accent-action-hi",
    );
  }
});
it("routes own-account editing to Account and never exposes self-follow", () => {
  renderWithListenProviders(<UserProfile />, {
    route: "/users/Jane",
    path: "/users/:username",
    auth: {
      user: { id: 7, email: "jane@example.test", name: "Jane", role: "user" },
    },
  });
  expect(screen.getByRole("link", { name: "Edit account" })).toHaveAttribute(
    "href",
    "/settings?tab=account",
  );
  expect(screen.getByRole("link", { name: "View Crate DNA" })).toHaveAttribute(
    "href",
    "/stats",
  );
  expect(screen.queryByRole("button", { name: "Follow" })).toBeNull();
  expect(api).not.toHaveBeenCalled();
});
it("retains the profile during background reads and prevents competing follow requests", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(api).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  vi.mocked(useApi).mockReturnValue({
    data: profile,
    loading: true,
    error: null,
    refetch,
  });
  renderWithListenProviders(<UserProfile />, {
    route: "/users/Jane",
    path: "/users/:username",
  });
  const follow = screen.getByRole("button", { name: "Follow" });
  fireEvent.click(follow);
  fireEvent.click(follow);
  expect(follow).toBeDisabled();
  expect(api).toHaveBeenCalledExactlyOnceWith("/api/users/7/follow", "POST");
  finish({ ok: true });
  await waitFor(() => expect(refetch).toHaveBeenCalledOnce());
  expect(screen.getByRole("heading", { name: "Jane Doe" })).toBeVisible();
});
it("keeps verified 404 distinct from network errors", () => {
  vi.mocked(useApi).mockReturnValue({
    data: null,
    loading: false,
    error: "not found",
    status: 404,
    refetch,
  });
  renderWithListenProviders(<UserProfile />, {
    route: "/users/Jane",
    path: "/users/:username",
  });
  expect(screen.getByTestId("error-state")).toHaveAttribute(
    "data-kind",
    "notFound",
  );
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});

it("presents affinity in the profile header instead of the social metric band", () => {
  renderWithListenProviders(<UserProfile />, {
    route: "/users/Jane",
    path: "/users/:username",
  });
  expect(
    within(screen.getByTestId("page-header")).getByText("Affinity"),
  ).toBeVisible();
  expect(screen.getAllByText("Affinity")).toHaveLength(1);
});
