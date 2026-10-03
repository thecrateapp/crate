import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlaylistListRow } from "@/components/playlists/PlaylistListRow";
import { longPress, pressMenuKey } from "@/test/item-action-gestures";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const navigate = vi.hoisted(() => vi.fn());

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useNavigate: () => navigate,
}));

function renderRow() {
  return renderWithListenProviders(
    <PlaylistListRow
      playlistId={9}
      name="Night Drive"
      trackCount={12}
      href="/playlist/9"
      detailEndpoint="/api/playlists/9"
    />,
  );
}

describe("PlaylistListRow", () => {
  beforeEach(() => {
    navigate.mockReset();
  });

  it("navigates from the primary button", async () => {
    const user = userEvent.setup();
    renderRow();

    screen.getByRole("button", { name: /Night Drive/ }).focus();
    await user.keyboard("{Enter}");

    expect(navigate).toHaveBeenCalledWith("/playlist/9");
  });

  it("opens the menu with Enter on the menu button without navigating", async () => {
    const user = userEvent.setup();
    const { container } = renderRow();

    expect(container.querySelector("[role='button']")).toBeNull();
    const trigger = screen.getByRole("button", { name: "More actions" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    trigger.focus();
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("opens the menu with right click and the menu key", async () => {
    const first = renderRow();
    fireEvent.contextMenu(screen.getByText("Night Drive").closest("article")!);
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    first.unmount();

    renderRow();
    pressMenuKey(screen.getByRole("button", { name: /Night Drive/ }));
    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });

  it("opens the action sheet with a touch long-press without navigating", async () => {
    renderRow();

    const row = screen.getByText("Night Drive").closest("article")!;
    await longPress(row);
    fireEvent.click(screen.getByRole("button", { name: /Night Drive/ }));

    expect(
      await screen.findByRole("dialog", { name: "Actions menu" }),
    ).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });
});
