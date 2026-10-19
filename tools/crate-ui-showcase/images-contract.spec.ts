import { expect, test } from "@playwright/test";

for (const host of ["preview", "storybook"]) {
  for (const width of [390, 1200]) {
    for (const coarse of [false, true]) {
      test.describe(`${host} images ${width} ${coarse ? "coarse" : "fine"}`, () => {
        test.use({ viewport: { width, height: 1000 }, hasTouch: coarse });
        test("image families retain geometry, identity, fallback, labels and actions", async ({
          page,
        }) => {
          const errors: string[] = [];
          const apiRequests: string[] = [];
          page.on("pageerror", (e) => errors.push(e.message));
          page.on("request", (r) => {
            if (new URL(r.url()).pathname.startsWith("/api/"))
              apiRequests.push(r.url());
          });
          await page.goto(
            host === "preview"
              ? "http://127.0.0.1:5186/review-1av-images.html"
              : "/iframe.html?id=reviews-1av-images--complete&viewMode=story",
          );
          await expect(
            page.getByRole("heading", { name: "Images keep their identity." }),
          ).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          const group = (name: string) =>
            page.getByRole("group", { name, exact: true });
          const media = group("MediaCover · loaded, missing and failed");
          await expect(
            media.getByRole("img", { name: "Failed album" }),
          ).toHaveAttribute("data-state", "fallback");
          await expect(media.getByText("CN")).toHaveCSS(
            "font-family",
            /JetBrains/,
          );
          await expect(media.getByText("CN")).toHaveCSS("font-size", "14px");
          const mediaBoxes = await media
            .locator('[data-slot="media-cover"]')
            .evaluateAll((nodes) =>
              nodes.map((node) => {
                const rect = node.getBoundingClientRect();
                return [rect.width, rect.height];
              }),
            );
          expect(mediaBoxes).toEqual([
            [112, 112],
            [112, 112],
            [112, 112],
          ]);
          const shape = group("MediaCover · shape roles");
          await expect(shape.locator('[data-shape="square"]')).toHaveCSS(
            "border-radius",
            "6px",
          );
          await expect(shape.locator('[data-shape="rounded"]')).toHaveCSS(
            "border-radius",
            "16px",
          );
          const sizes = group("Avatar · canonical sizes");
          expect(
            await sizes
              .locator('[data-slot="avatar"]')
              .evaluateAll((nodes) =>
                nodes.map((n) => n.getBoundingClientRect().width),
              ),
          ).toEqual([24, 32, 40, 56, 80]);
          await expect(
            group("Avatar · image, fallback and decorative").getByRole("img", {
              name: "Nina Simone",
            }),
          ).toHaveText("NS");
          await expect(
            group("Avatar · image, fallback and decorative").getByRole("img", {
              name: "Decorative portrait",
            }),
          ).toHaveCount(0);
          const playlists = group("PlaylistArtwork · cover and collage counts");
          await expect(
            playlists.locator('[data-slot="playlist-artwork"]'),
          ).toHaveCount(5);
          const collage = playlists.getByRole("img", {
            name: "Playlist with 3 covers",
            exact: true,
          });
          await expect(collage).toHaveAttribute("data-layout", "collage");
          const cells = await collage.locator("img").evaluateAll((nodes) =>
            nodes.map((n) => {
              const r = n.getBoundingClientRect();
              return { x: r.x, y: r.y, w: r.width, h: r.height };
            }),
          );
          expect(cells).toHaveLength(3);
          expect(cells[0]!.w).toBeCloseTo(55, 1);
          expect(cells[2]!.w).toBe(112);
          expect(cells[1]!.x - cells[0]!.x - cells[0]!.w).toBeCloseTo(2, 1);
          const placeholders = group(
            "PlaylistArtwork · deduplication, empty and failed",
          );
          await expect(
            placeholders.getByRole("img", { name: "Failed playlist cover" }),
          ).toHaveAttribute("data-layout", "placeholder");
          await expect(
            placeholders.getByRole("img", { name: "Duplicate cover playlist" }),
          ).toHaveAttribute("src", /^data:image\/svg/);
          await expect(
            placeholders.getByRole("img", { name: "Empty playlist" }),
          ).toHaveAttribute("data-layout", "placeholder");
          const mark = placeholders.locator('[data-slot="playlist-artwork"]', {
            has: page.locator('img[aria-hidden="true"]'),
          });
          await expect(mark).toHaveCount(1);
          const changing = group(
            "MediaCover · source and fallback replacement",
          );
          const before = await changing
            .getByRole("img", { name: "Changing album" })
            .getAttribute("src");
          await changing
            .getByRole("button", { name: "Change cover", exact: true })
            .click();
          await expect(
            changing.getByRole("img", { name: "Changing album" }),
          ).not.toHaveAttribute("src", before!);
          await changing
            .getByRole("button", { name: "Fail primary cover" })
            .click();
          await expect(
            changing.getByRole("img", { name: "Changing album" }),
          ).toHaveAttribute("src", /^data:image\/svg/);
          const controls = group("Solid controls · equivalent geometry");
          for (const name of ["Follow artwork", "Download artwork"]) {
            await expect(controls.getByRole("button", { name })).toHaveCSS(
              "width",
              coarse ? "44px" : "40px",
            );
            await expect(controls.getByRole("button", { name })).toHaveCSS(
              "height",
              coarse ? "44px" : "40px",
            );
          }
          await controls
            .getByRole("button", { name: "Follow artwork" })
            .click();
          await expect(
            controls.getByRole("button", { name: "Follow artwork" }),
          ).toHaveAttribute("aria-pressed", "true");
          await controls
            .getByRole("button", { name: "Download artwork" })
            .click();
          await expect(page.getByRole("status")).toHaveText(
            "Artwork download requested.",
          );
          const brands = group("Brand assets · named and decorative");
          await expect(brands.getByRole("img")).toHaveCount(3);
          const ids = await brands
            .locator("linearGradient")
            .evaluateAll((nodes) => nodes.map((n) => n.id));
          expect(new Set(ids).size).toBe(ids.length);
          const gaps = await page
            .locator('[data-slot="form-field"]')
            .evaluateAll((fields) =>
              fields.map((field) => {
                const caption = field.querySelector(
                  '[data-slot="form-field-label"]',
                )!;
                const sample = field.querySelector('[role="group"]')!;
                return (
                  sample.getBoundingClientRect().top -
                  caption.getBoundingClientRect().bottom
                );
              }),
            );
          gaps.forEach((gap) => expect(gap).toBeCloseTo(8, 1));
          await expect(
            page
              .locator('[data-slot="form-field-label"]')
              .first()
              .locator("span")
              .first(),
          ).toHaveCSS("text-transform", "uppercase");
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          expect(errors).toEqual([]);
          expect(apiRequests).toEqual([]);
        });
      });
    }
  }
}

test("six image and identity entries load their live English contracts", async ({
  page,
}) => {
  for (const family of [
    "avatar",
    "entityavatar",
    "mediacover",
    "playlistartwork",
    "cratelogo",
    "bandcamplogo",
  ]) {
    await page.goto(`/?path=/docs/components-${family}--docs`);
    const frame = page.frameLocator("#storybook-preview-iframe");
    await expect(
      frame.getByRole("heading", { name: "Contract", exact: true }),
    ).toBeVisible();
    await expect(
      frame.getByText("Visual review pending · 1AV", { exact: true }),
    ).toBeVisible();
    await expect(frame.getByText(/The approved mockup/)).toBeVisible();
  }
});
