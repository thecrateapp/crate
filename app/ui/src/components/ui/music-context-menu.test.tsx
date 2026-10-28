import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

import { APP_CONTEXT_MENU_SURFACE } from "@crate/ui/primitives/AppPopover";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { MusicContextMenu } from "./music-context-menu";

function openMenu() {
  renderWithAdminProviders(
    <MusicContextMenu
      type="album"
      artist="Low"
      artistId={7}
      album="Things We Lost in the Fire"
      albumId={42}
    >
      <div>Album card</div>
    </MusicContextMenu>,
  );
  fireEvent.contextMenu(screen.getByText("Album card"));
  const content = document.querySelector('[data-slot="context-menu-content"]');
  expect(content).not.toBeNull();
  return content!;
}

describe("MusicContextMenu", () => {
  it("opens with the album entries", () => {
    openMenu();

    expect(screen.getByText("Go to Artist")).toBeInTheDocument();
    expect(screen.getByText("Open Album")).toBeInTheDocument();
    expect(screen.getByText("Enrich Artist")).toBeInTheDocument();
  });

  it("keeps the shared context menu surface", () => {
    const content = openMenu();

    for (const surfaceClass of APP_CONTEXT_MENU_SURFACE.split(" ")) {
      expect(content).toHaveClass(surfaceClass);
    }
    // A card background or border would replace the menu surface through
    // tailwind-merge and turn the menu into a glass card.
    expect(content).not.toHaveClass("bg-card");
    expect(content).not.toHaveClass("border-border");
  });
});

it.each([false, true])(
  "exposes enrichment only with metadata write permission (%s)",
  async (allowed) => {
    renderWithAdminProviders(
      <MusicContextMenu type="artist" artist="Converge" artistId={7}>
        <button>Artist</button>
      </MusicContextMenu>,
      { auth: { hasCapability: () => allowed } },
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: "Artist" }));
    if (allowed)
      expect(
        await screen.findByRole("menuitem", { name: "Enrich Artist" }),
      ).toBeVisible();
    else
      expect(
        screen.queryByRole("menuitem", { name: "Enrich Artist" }),
      ).not.toBeInTheDocument();
  },
);
