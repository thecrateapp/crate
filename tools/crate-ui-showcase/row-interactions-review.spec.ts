import { expect, test } from "@playwright/test";

for (const host of ["storybook", "standalone"]) {
  for (const coarse of [false, true]) {
    test.describe(`${host} track and navigation states ${coarse ? "coarse" : "fine"}`, () => {
      test.use({
        viewport: { width: coarse ? 375 : 1200, height: 900 },
        hasTouch: coarse,
      });
      test("track hover, Hairline selection and navigation geometry share their real recipes", async ({
        page,
      }) => {
        await page.goto(
          host === "storybook"
            ? "/iframe.html?id=reviews-1ba-album-access--complete&viewMode=story"
            : "http://127.0.0.1:5186/review-1ba-album-access.html",
        );
        const states = page.getByRole("group", {
          name: "Track interactions · hover, selected and current are separate states",
          exact: true,
        });
        const reference = states.getByRole("listitem");
        const selected = states.getByRole("row", {
          name: "Selected track",
          exact: true,
        });
        const current = states.getByRole("row", {
          name: "Current track",
          exact: true,
        });
        const referenceImage = await reference.evaluate(
          (el) => getComputedStyle(el).backgroundImage,
        );
        expect(referenceImage).toContain("linear-gradient");
        await expect(selected).toHaveCSS("background-image", referenceImage);
        await expect(current).toHaveCSS("background-image", referenceImage);
        await expect(selected).not.toHaveAttribute("aria-current");
        await expect(current).toHaveAttribute("aria-current", "true");
        const marker = await selected.evaluate((el) => ({
          width: getComputedStyle(el, "::before").width,
          color: getComputedStyle(el, "::before").backgroundColor,
        }));
        expect(marker.width).toBe("2px");
        expect(marker.color).toBe(
          await reference
            .locator('[data-slot="active-bar"]')
            .evaluate((el) => getComputedStyle(el).backgroundColor),
        );
        const idle = states.getByRole("row", {
          name: "Hover track",
          exact: true,
        });
        const before = await idle.evaluate(
          (el) => getComputedStyle(el).backgroundColor,
        );
        await idle.hover();
        if (coarse) await expect(idle).toHaveCSS("background-color", before);
        else
          await expect
            .poll(() =>
              idle.evaluate((el) => getComputedStyle(el).backgroundColor),
            )
            .not.toBe(before);
        const disabled = states.getByRole("row", {
          name: "Unavailable track",
          exact: true,
        });
        const disabledBefore = await disabled.evaluate(
          (el) => getComputedStyle(el).backgroundColor,
        );
        await disabled.hover();
        await expect(disabled).toHaveCSS("background-color", disabledBefore);
        await selected.focus();
        await selected.press("Enter");
        await expect(selected).toHaveAttribute("aria-selected", "false");
        await expect(selected).toHaveCSS("background-image", "none");
        await selected.press("Enter");
        await expect(selected).toHaveCSS("background-image", referenceImage);
        const nav = page.getByRole("group", {
          name: "Collection navigation · one item geometry across both levels",
          exact: true,
        });
        const parent = nav.getByRole("button", {
          name: "Collection",
          exact: true,
        });
        await parent.click();
        const height = (await parent.boundingBox())!.height;
        expect(height).toBe(44);
        expect(
          (await nav
            .getByRole("link", { name: "Music", exact: true })
            .boundingBox())!.height,
        ).toBe(height);
        const children = nav.getByRole("listitem");
        await expect(children).toHaveCount(7);
        for (const child of await children.all()) {
          expect((await child.boundingBox())!.height).toBe(height);
          expect((await child.getByRole("link").boundingBox())!.height).toBe(
            height,
          );
        }
        await expect(
          nav.getByRole("link", { name: "Artists", exact: true }),
        ).toHaveAttribute("aria-current", "page");
      });
    });
  }
}
