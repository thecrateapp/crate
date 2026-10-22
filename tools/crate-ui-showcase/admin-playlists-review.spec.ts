import { expect, test } from "@playwright/test";

for (const width of [1440, 768, 390]) {
  test(`A5 playlists Storybook stories render at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    const requests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/") || url.hostname !== "127.0.0.1")
        requests.push(request.url());
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(
      "/iframe.html?id=reviews-admin-a5-playlists--playlist-editor&viewMode=story",
    );
    await expect(
      page.getByRole("heading", { name: "Costa de noche", exact: true }),
    ).toBeVisible();
    const editorHeader = page.locator('header[data-slot="page-header-layout"]');
    const headerArtwork = editorHeader.locator(
      '[data-slot="playlist-artwork"]',
    );
    const headerIdentity = editorHeader.locator(
      '[data-slot="page-header-identity"]',
    );
    const [headerArtworkBox, headerIdentityBox] = await Promise.all([
      headerArtwork.boundingBox(),
      headerIdentity.boundingBox(),
    ]);
    expect(headerArtworkBox).not.toBeNull();
    expect(headerIdentityBox).not.toBeNull();
    expect(
      Math.abs(headerArtworkBox!.width - headerArtworkBox!.height),
    ).toBeLessThanOrEqual(1);
    if (width >= 768) {
      expect(headerArtworkBox!.height).toBeGreaterThanOrEqual(220);
      expect(
        Math.abs(headerArtworkBox!.height - headerIdentityBox!.height),
      ).toBeLessThanOrEqual(1);
      expect(headerIdentityBox!.x).toBeGreaterThan(
        headerArtworkBox!.x + headerArtworkBox!.width,
      );
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    await page.goto(
      "/iframe.html?id=reviews-admin-a5-playlists--playlist-list&viewMode=story",
    );
    await expect(
      page.getByRole("heading", { name: "System Playlists", exact: true }),
    ).toBeVisible();
    const playlistRows = page.locator('[data-slot="hairline-row"]');
    await expect(playlistRows).toHaveCount(5);
    let previousRowBox: { y: number; height: number } | null = null;
    for (const row of await playlistRows.all()) {
      const artwork = row.locator('[data-slot="playlist-artwork"]');
      const information = row.locator('[data-slot="playlist-row-information"]');
      const [rowBox, artworkBox, informationBox] = await Promise.all([
        row.boundingBox(),
        artwork.boundingBox(),
        information.boundingBox(),
      ]);

      expect(rowBox).not.toBeNull();
      expect(artworkBox).not.toBeNull();
      expect(informationBox).not.toBeNull();
      expect(Math.abs(artworkBox!.y - rowBox!.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(artworkBox!.height - rowBox!.height)).toBeLessThanOrEqual(
        1,
      );
      expect(
        Math.abs(artworkBox!.width - artworkBox!.height),
      ).toBeLessThanOrEqual(1);
      expect(informationBox!.x).toBeGreaterThanOrEqual(
        artworkBox!.x + artworkBox!.width + 8,
      );
      if (previousRowBox) {
        expect(
          rowBox!.y - (previousRowBox.y + previousRowBox.height),
        ).toBeGreaterThanOrEqual(15);
      }
      previousRowBox = rowBox;
      if (width === 390) {
        expect(informationBox!.width).toBeGreaterThanOrEqual(160);
      }
    }
    if (width < 768) {
      const rowActions = page.getByRole("button", {
        name: "Actions for Costa de noche",
      });
      await expect(rowActions).toBeVisible();
      expect(
        await rowActions.evaluate((element) => Boolean(element.closest("a"))),
      ).toBe(false);
      await rowActions.click();
      await expect(
        page.getByRole("menuitem", { name: "Edit playlist" }),
      ).toBeVisible();
      await expect(
        page.getByRole("menuitem", { name: "Deactivate" }),
      ).toBeVisible();
      await expect(
        page.getByRole("menuitem", { name: "Delete playlist" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
    }
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
  });
}

test("list pagination Storybook example navigates and announces its range", async ({
  page,
}) => {
  await page.goto(
    "/iframe.html?id=components-admin-list-pagination--multiple-pages&viewMode=story",
  );
  const pagination = page.getByRole("navigation", {
    name: "playlists pagination",
  });
  await expect(pagination).toContainText("21–40 of 43 · page 2 of 3");
  await pagination.getByRole("button", { name: "Next playlists page" }).click();
  await expect(pagination).toContainText("41–43 of 43 · page 3 of 3");
});
