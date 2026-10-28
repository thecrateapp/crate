import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, width: number) {
  const errors: string[] = [];
  const unexpected: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname.startsWith("/api/") ||
      (!["127.0.0.1", "localhost"].includes(url.hostname) &&
        url.protocol !== "data:")
    )
      unexpected.push(request.url());
  });
  await page.setViewportSize({ width, height: 1120 });
  await page.goto("/review-admin-playlists.html");
  const controls = page.locator('[data-admin-review-controls="playlists"]');
  await expect(
    page.getByRole("heading", { name: "Costa de noche", exact: true }),
  ).toBeVisible();
  await expect(
    controls.getByRole("radiogroup", { name: "Página de revisión" }),
  ).toBeVisible();
  return { controls, errors, unexpected };
}

async function expectNoHorizontalOverflow(page: Page) {
  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    overflowing: Array.from(document.querySelectorAll("body *"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          text: element.textContent?.trim().slice(0, 50),
          className: element.getAttribute("class"),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter((element) => element.right > window.innerWidth + 1)
      .slice(0, 10),
  }));
  expect(
    layout.scrollWidth <= layout.viewportWidth,
    JSON.stringify(layout),
  ).toBe(true);
}

async function expectPlaylistArtworkRows(page: Page) {
  const rows = page.locator('[data-slot="hairline-row"]');
  await expect(rows).toHaveCount(5);

  let previousRowBox: { y: number; height: number } | null = null;
  for (const row of await rows.all()) {
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
    if (page.viewportSize()?.width === 390) {
      expect(informationBox!.width).toBeGreaterThanOrEqual(160);
    }
  }
}

async function expectFlatPlaylistComposer(
  page: Page,
  trigger: string,
  headingText: string,
) {
  await page.getByRole("button", { name: trigger, exact: true }).click();
  const heading = page.getByRole("heading", {
    name: headingText,
    exact: true,
  });
  await expect(heading).toBeVisible();
  await expect(
    heading.locator("xpath=ancestor::*[@data-slot='card'][1]"),
  ).toHaveCSS("box-shadow", "none");
  await page.getByRole("button", { name: "Close", exact: true }).click();
}

async function expectPlaylistEditorIdentity(page: Page, width: number) {
  const header = page.locator('header[data-slot="page-header-layout"]');
  const artwork = header.locator('[data-slot="playlist-artwork"]');
  const identity = header.locator('[data-slot="page-header-identity"]');
  const [artworkBox, identityBox] = await Promise.all([
    artwork.boundingBox(),
    identity.boundingBox(),
  ]);

  expect(artworkBox).not.toBeNull();
  expect(identityBox).not.toBeNull();
  expect(Math.abs(artworkBox!.width - artworkBox!.height)).toBeLessThanOrEqual(
    1,
  );
  if (width >= 768) {
    expect(artworkBox!.height).toBeGreaterThanOrEqual(220);
    expect(
      Math.abs(artworkBox!.height - identityBox!.height),
    ).toBeLessThanOrEqual(1);
    expect(identityBox!.x).toBeGreaterThan(artworkBox!.x + artworkBox!.width);
  }
}

for (const width of [1440, 768, 390]) {
  test(`Admin playlists review scene loads both real pages at ${width}px`, async ({
    page,
  }) => {
    const { controls, errors, unexpected } = await open(page, width);
    const switcher = controls.getByRole("radiogroup", {
      name: "Página de revisión",
    });

    await expect(
      page.getByRole("heading", { name: "Costa de noche", exact: true }),
    ).toBeVisible();
    await expectPlaylistEditorIdentity(page, width);
    await expectNoHorizontalOverflow(page);

    await switcher.getByRole("radio", { name: "Playlists" }).click();
    await expect(
      page.getByRole("heading", { name: "System Playlists", exact: true }),
    ).toBeVisible();
    await expectPlaylistArtworkRows(page);
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
    await expectNoHorizontalOverflow(page);

    await switcher.getByRole("radio", { name: "Editor" }).click();
    await expect(
      page.getByRole("heading", { name: "Costa de noche", exact: true }),
    ).toBeVisible();
    await expectPlaylistEditorIdentity(page, width);
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
  });
}

test("editor review scene exposes loading, missing and stream controls", async ({
  page,
}) => {
  const { controls } = await open(page, 1440);

  await controls.getByRole("radio", { name: "Cargando" }).click();
  await expect(
    page.getByRole("button", { name: "Completar acción de muestra" }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Completar acción de muestra" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Costa de noche", exact: true }),
  ).toBeVisible();

  await controls.getByRole("radio", { name: "No encontrada" }).click();
  await expect(
    page.getByText("Playlist not found", { exact: true }),
  ).toBeVisible();

  await controls.getByRole("radio", { name: "Smart" }).click();
  await expect(
    page.getByRole("button", { name: "Enviar cambio SSE" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Enviar cambio SSE" }).click();
  await expect(controls.getByRole("status")).toContainText("SSE local");
});

test("static and smart playlist composers use the flat shared card surface", async ({
  page,
}) => {
  const { controls } = await open(page, 1440);
  await controls.getByRole("radio", { name: "Playlists" }).click();
  await expectFlatPlaylistComposer(page, "New static", "New static playlist");
  await expectFlatPlaylistComposer(page, "New smart", "New smart playlist");
});
