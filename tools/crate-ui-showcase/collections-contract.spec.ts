import { expect, test } from "@playwright/test";
for (const host of ["preview", "storybook"]) {
  for (const coarse of [false, true]) {
    test.describe(`${host} track playback ${
      coarse ? "coarse" : "fine"
    }`, () => {
      test.use({ viewport: { width: 1100, height: 1000 }, hasTouch: coarse });
      test("keeps V2 cover/play proportions, white glyph, ring and independent actions", async ({
        page,
      }) => {
        await page.goto(
          host === "preview"
            ? "http://127.0.0.1:5186/review-1aw-collections.html"
            : "/iframe.html?id=reviews-1aw-collections--complete&viewMode=story",
        );
        const row = page
          .getByRole("group", { name: "Playback examples", exact: true })
          .getByRole("row", { name: "Horizonte", exact: true });
        await expect(row).toBeVisible();
        await row.hover();
        const glyph = row.locator(".crate-track-glyph");
        await expect(glyph).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        expect(await glyph.evaluate((el) => getComputedStyle(el).color)).toBe(
          await row
            .locator(".crate-track-title")
            .evaluate((el) => getComputedStyle(el).color),
        );
        await expect(glyph.locator("svg")).toHaveAttribute("width", "18");
        const cover = await row.locator(".crate-track-leading").boundingBox();
        expect(cover!.width).toBe(48);
        expect((await glyph.boundingBox())!.width).toBe(24);
        await row
          .getByRole("button", { name: "Play Horizonte", exact: true })
          .click();
        const ring = row.getByTestId("track-row-playback-progress");
        await expect(ring).toBeVisible();
        expect((await ring.boundingBox())!.width).toBe(40);
        expect((await ring.boundingBox())!.width).toBeLessThan(cover!.width);
        await expect(ring.locator(".track-row-playback-ring")).toHaveAttribute(
          "stroke-width",
          "2",
        );
        const before = await ring
          .locator(".track-row-playback-ring")
          .getAttribute("stroke-dashoffset");
        await page
          .getByRole("slider", { name: "Playback position" })
          .fill("80");
        expect(
          await ring
            .locator(".track-row-playback-ring")
            .getAttribute("stroke-dashoffset"),
        ).not.toBe(before);
        await row.getByRole("button", { name: "Queue Horizonte" }).click();
        await expect(row).toHaveAttribute("aria-current", "true");
        await expect(
          row.getByRole("button", { name: "Pause Horizonte" }),
        ).toBeVisible();
        const compact = page.getByRole("row", { name: "Compact queue track" });
        await compact
          .getByRole("button", { name: "Play Compact queue track" })
          .click();
        expect(
          (await compact
            .getByTestId("track-row-playback-progress")
            .boundingBox())!.width,
        ).toBe(40);
        const hit = (await compact
          .locator(".crate-track-leading")
          .boundingBox())!.width;
        expect(hit).toBe(48);
      });
    });
  }
}

for (const host of ["preview", "storybook"]) {
  for (const width of [390, 1200]) {
    test.describe(`${host} collection layout ${width}`, () => {
      test.use({ viewport: { width, height: 1000 } });
      test("preserves minimum media, typography, active/selection, label gaps and native actions", async ({
        page,
      }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const api: string[] = [];
        page.on("request", (request) => {
          if (new URL(request.url()).pathname.startsWith("/api/"))
            api.push(request.url());
        });
        await page.goto(
          host === "preview"
            ? "http://127.0.0.1:5186/review-1aw-collections.html"
            : "/iframe.html?id=reviews-1aw-collections--complete&viewMode=story",
        );
        await expect(
          page.getByRole("heading", {
            name: "One language for every collection.",
          }),
        ).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const min = page.getByRole("group", {
          name: "MediaCover · minimum 48px for tracks, albums and artists",
          exact: true,
        });
        const dimensions = await min
          .locator('[data-slot="media-cover"]')
          .evaluateAll((nodes) =>
            nodes.map((node) => {
              const r = node.getBoundingClientRect();
              return [r.width, r.height];
            }),
          );
        expect(dimensions).toEqual([
          [48, 48],
          [48, 48],
          [48, 48],
        ]);
        const active = page.getByRole("link", { name: "Open active album" });
        await expect(active).toHaveAttribute("aria-current", "true");
        const article = active.locator("..");
        expect(
          await article.evaluate(
            (node) => getComputedStyle(node, "::before").width,
          ),
        ).toBe("2px");
        const bg = await article.evaluate(
          (node) => getComputedStyle(node).backgroundColor,
        );
        await article.hover();
        await expect(article).toHaveCSS("background-color", bg);
        await expect(active.locator(".crate-entity-title")).toHaveCSS(
          "font-size",
          "14px",
        );
        await expect(active.locator(".crate-entity-title")).toHaveCSS(
          "font-family",
          /IBM Plex Sans/,
        );
        await expect(
          page.getByRole("link", { name: /Selected album/ }),
        ).not.toHaveAttribute("aria-current");
        const disabled = page.getByRole("button", {
          name: "Unavailable album",
        });
        await expect(disabled).toBeDisabled();
        const coverAction = page.getByRole("link", { name: "Open card album" });
        await expect(coverAction).toHaveAttribute("href", "/albums/october");
        const primary = page.getByRole("group", {
          name: "EntityPrimaryAction · native link, external, callback, disabled and static",
          exact: true,
        });
        await expect(
          primary.getByRole("link", { name: "External album link" }),
        ).toHaveAttribute("rel", /noopener/);
        await primary.getByRole("button", { name: "Callback action" }).click();
        await expect(
          page.getByRole("status").filter({ hasText: "Callback action." }),
        ).toBeVisible();
        await primary
          .getByRole("link", { name: "Internal album link" })
          .click();
        await expect(page.getByTestId("route-probe")).toHaveText(
          "/albums/october",
        );
        const gaps = await page
          .locator(".crate-form-field")
          .filter({ has: page.locator('[role="group"]') })
          .evaluateAll((fields) =>
            fields.map((field) => {
              const label = field.querySelector(
                '[data-slot="form-field-label"]',
              )!;
              const group = field.querySelector('[role="group"]')!;
              return (
                group.getBoundingClientRect().top -
                label.getBoundingClientRect().bottom
              );
            }),
          );
        expect(gaps.length).toBeGreaterThan(8);
        gaps.forEach((gap) => expect(gap).toBeCloseTo(8, 1));
        const profiles = page.getByRole("region", { name: "Artist profiles" });
        expect(
          await profiles
            .locator('[data-slot="entity-card"]')
            .evaluateAll((nodes) =>
              nodes.map((node) =>
                Math.round(node.getBoundingClientRect().width),
              ),
            ),
        ).toEqual([116, 156, 172]);
        const rail = page.getByRole("region", { name: "Content rail" });
        await expect(rail).toHaveAttribute("tabindex", "0");
        await rail.focus();
        await page.keyboard.press("ArrowRight");
        await expect(
          page.getByRole("group", { name: "Empty tracks" }),
        ).toContainText("No tracks in this collection.");
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        expect(errors).toEqual([]);
        expect(api).toEqual([]);
      });
    });
  }
}

test("all six collection entries expose their documented live contracts", async ({
  page,
}) => {
  for (const family of [
    "entitycard",
    "entityrow",
    "entityprimaryaction",
    "tracklist",
    "mediagrid",
    "mediarail",
  ]) {
    await page.goto(`/?path=/docs/components-${family}--docs`);
    const frame = page.frameLocator("#storybook-preview-iframe");
    await expect(
      frame.getByRole("heading", { name: "Contract", exact: true }),
    ).toBeVisible();
    await expect(
      frame.getByText("Visual review approved · 1AW", { exact: true }),
    ).toBeVisible();
  }
});

test("actual Listen managed thumbnails paint inside their frames in both densities", async ({
  page,
}) => {
  const api: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      api.push(request.url());
  });
  await page.goto("http://127.0.0.1:5174/tests/track-cover-contract.html");
  for (const density of ["default", "compact"]) {
    const row = page.getByRole("row", { name: `${density} managed cover` });
    const image = row.getByRole("img", { name: `${density} artwork` });
    await expect(image).toBeVisible();
    await expect(row.locator("div[data-artwork-state]")).toHaveAttribute(
      "data-artwork-state",
      "ready",
    );
    const box = (await image.boundingBox())!;
    expect(box.width).toBe(48);
    expect(box.height).toBe(48);
    expect(
      await image.evaluate((node) => (node as HTMLImageElement).naturalWidth),
    ).toBeGreaterThan(0);
    const frame = (await row.locator(".crate-track-leading").boundingBox())!;
    expect(box.x).toBeCloseTo(frame.x, 1);
    expect(box.y).toBeCloseTo(frame.y, 1);
  }
  const virtual = page.getByRole("group", { name: "Virtualized library" });
  await expect(virtual).toHaveAttribute("data-virtualized", "true");
  const count = await virtual.getByRole("row").count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThan(80);
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await expect(
    virtual.getByRole("row", { name: "Recording 79", exact: true }),
  ).toBeVisible();
  expect(api).toEqual([]);
});

test("callback entry demonstrates a native button rather than inheriting its base link", async ({
  page,
}) => {
  await page.goto(
    "/iframe.html?id=components-entityprimaryaction--callback&viewMode=story",
  );
  await expect(
    page.getByRole("button", { name: "Open album callback" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open album callback" }),
  ).toHaveCount(0);
});
