import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { clearProfileCardCacheForTests } from "./ProfileHoverCard";
import { UserRow } from "./UserRow";

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
  apiAssetUrl: vi.fn((path: string) => path),
  resolveMaybeApiAssetUrl: vi.fn((value?: string | null) => value ?? null),
  getApiBase: vi.fn(() => ""),
  getAuthToken: vi.fn(() => null),
}));

const user = {
  id: 9,
  username: "maria",
  display_name: "Maria",
  avatar: null,
  bio: "Hardcore kid",
};

function renderRow(following?: boolean) {
  return renderWithListenProviders(
    <UserRow user={user} following={following} />,
  );
}

describe("UserRow", () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    clearProfileCardCacheForTests();
  });

  it("links to the profile inside an article with a sibling menu button", () => {
    renderRow(false);

    const article = screen.getByRole("article");
    const link = screen.getByRole("link", { name: /Maria/ });
    expect(link).toHaveAttribute("href", "/users/maria");
    expect(article).toContainElement(link);
    expect(link).not.toContainElement(
      screen.getByRole("button", { name: "More actions" }),
    );
    expect(screen.getByText("@maria")).toBeInTheDocument();
    expect(screen.getByText("Hardcore kid")).toBeInTheDocument();
  });

  it("offers follow, profile and share from the more button", async () => {
    vi.mocked(api).mockResolvedValue({});
    renderRow(false);

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(
      screen.getByRole("menuitem", { name: /View profile/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: /Share profile/ }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("menuitem", { name: /^Follow/ }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith("/api/users/9/follow", "POST");
    });
  });

  it("opens the menu with a touch long-press without navigating", () => {
    vi.useFakeTimers();
    try {
      renderRow(true);
      const link = screen.getByRole("link", { name: /Maria/ });

      fireEvent.pointerDown(link, { pointerType: "touch" });
      act(() => {
        vi.advanceTimersByTime(450);
      });
      fireEvent.pointerUp(link, { pointerType: "touch" });
    } finally {
      vi.useRealTimers();
    }

    expect(screen.getByRole("menuitem", { name: /Unfollow/ })).toBeVisible();
  });

  it("loads the follow state lazily when the menu opens", async () => {
    vi.mocked(api).mockResolvedValue({
      id: 9,
      username: "maria",
      relationship_state: {
        following: true,
        followed_by: false,
        is_friend: false,
      },
    });
    renderRow();

    expect(api).not.toHaveBeenCalled();
    fireEvent.contextMenu(screen.getByRole("article"), {
      clientX: 10,
      clientY: 10,
    });

    expect(api).toHaveBeenCalledWith("/api/users/maria/card");
    expect(
      await screen.findByRole("menuitem", { name: /Unfollow/ }),
    ).toBeVisible();
  });

  it("hides follow for the signed-in user", () => {
    renderWithListenProviders(<UserRow user={{ ...user, id: 1 }} />);

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.queryByRole("menuitem", { name: /Follow/ })).toBeNull();
    expect(
      screen.getByRole("menuitem", { name: /View profile/ }),
    ).toBeVisible();
  });
});
