import { expect, test } from "@playwright/test";
for (const host of ["preview", "storybook"]) {
  for (const width of [390, 1200]) {
    for (const coarse of [false, true]) {
      test.describe(`${host} ${width}px ${coarse ? "coarse" : "fine"}`, () => {
        test.use({ viewport: { width, height: 1100 }, hasTouch: coarse });
        test("objects, panels and artwork controls own their surfaces and geometry", async ({
          page,
        }) => {
          const errors: string[] = [];
          const api: string[] = [];
          page.on("pageerror", (e) => errors.push(e.message));
          page.on("request", (r) => {
            if (new URL(r.url()).pathname.startsWith("/api/"))
              api.push(r.url());
          });
          await page.goto(
            host === "preview"
              ? "http://127.0.0.1:5186/review-1at-surfaces.html"
              : "/iframe.html?id=reviews-1at-surfaces--complete&viewMode=story",
          );
          const object = page.getByRole("article", {
            name: "Saved query",
            exact: true,
          });
          await expect(object).toBeVisible();
          for (const card of await page.locator('[data-slot="card"]').all()) {
            await expect(card).toHaveCSS("background-color", "rgb(13, 14, 20)");
            await expect(card).toHaveCSS("border-radius", "14px");
            await expect(card).toHaveCSS("border-top-width", "1px");
            await expect(card).toHaveCSS("box-shadow", "none");
            await expect(card).toHaveCSS("backdrop-filter", "none");
            await expect(card).toHaveCSS("padding-top", "24px");
          }
          const title = object.getByRole("heading", {
            level: 2,
            name: "Saved query",
          });
          await expect(title).toHaveCSS("font-family", /Poppins/);
          await expect(title).toHaveCSS("font-size", "16px");
          await expect(title).toHaveCSS("font-weight", "600");
          await expect(title).toHaveCSS("line-height", "24px");
          const headingBox = await title.boundingBox();
          const actionBox = await object
            .getByRole("button", { name: "Edit saved query" })
            .boundingBox();
          expect(actionBox!.y).toBe(headingBox!.y);
          const panel = page.getByRole("region", {
            name: "Resources",
            exact: true,
          });
          await expect(panel).toHaveAccessibleDescription(
            "A section with a rule and no filled box.",
          );
          await expect(panel).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
          await expect(panel).toHaveCSS("border-top-width", "1px");
          await expect(panel).toHaveCSS("border-right-width", "0px");
          await expect(panel).toHaveCSS("padding-top", "22px");
          await expect(panel).toHaveCSS("box-shadow", "none");
          await expect(panel).toHaveCSS("backdrop-filter", "none");
          await expect(
            panel.locator('[data-slot="instrument-panel-header"]'),
          ).toHaveCSS("margin-bottom", "20px");
          await expect(
            panel.getByRole("heading", { name: "Resources", level: 2 }),
          ).toHaveCSS("font-family", /JetBrains/);
          await expect(panel.locator('[aria-live="polite"]')).toHaveText(
            "Ready",
          );
          await panel.getByRole("button", { name: "Pause status" }).click();
          await expect(panel.locator('[aria-live="polite"]')).toHaveText(
            "Paused",
          );
          await panel.getByRole("button", { name: "Hide rule" }).click();
          await expect(panel).toHaveCSS("border-top-width", "0px");
          await expect(panel).toHaveCSS("padding-top", "22px");
          await expect(
            page.getByRole("region", { name: "Collection notes" }),
          ).toHaveCSS("border-top-width", "0px");
          for (const [region, caption] of [
            ["Separators", "Separator · horizontal and vertical"],
            ["Artwork controls", "Solid controls on artwork"],
          ] as const) {
            await expect(
              page
                .getByRole("region", { name: region })
                .getByRole("group", { name: caption, exact: true }),
            ).toBeVisible();
            const gap = await page
              .getByRole("region", { name: region })
              .getByText(caption, { exact: true })
              .evaluate((element) => {
                const label =
                  element.closest('[data-slot="form-field-label"]') ?? element;
                const box = label.getBoundingClientRect();
                return (
                  label.nextElementSibling!.getBoundingClientRect().top -
                  box.bottom
                );
              });
            expect
              .soft(gap, `${caption}: actual caption-to-sample gap`)
              .toBeCloseTo(8, 1);
          }
          const artworkControls = page
            .getByRole("region", { name: "Artwork controls" })
            .getByRole("button");
          await expect(artworkControls).toHaveCount(2);
          for (const control of await artworkControls.all()) {
            await expect
              .soft(control)
              .toHaveCSS("width", coarse ? "44px" : "40px");
            await expect
              .soft(control)
              .toHaveCSS("height", coarse ? "44px" : "40px");
            await expect
              .soft(control.locator("svg"))
              .toHaveCSS("width", "18px");
            await expect
              .soft(control.locator("svg"))
              .toHaveCSS("height", "18px");
          }
          const horizontal = page.getByRole("separator", {
            name: "Between object and artwork",
          });
          const vertical = page.getByRole("separator", {
            name: "Between adjacent regions",
          });
          await expect(horizontal).toHaveCSS("height", "1px");
          await expect(vertical).toHaveCSS("width", "1px");
          await expect(vertical).toHaveCSS("height", "80px");
          for (const control of [
            page.getByRole("button", { name: "Follow artwork" }),
            page.getByRole("button", { name: "Download artwork" }),
          ]) {
            await expect(control).toHaveCSS(
              "background-color",
              "rgb(13, 14, 20)",
            );
            await expect(control).toHaveCSS("box-shadow", "none");
            await expect(control).toHaveCSS("backdrop-filter", "none");
          }
          await page.getByRole("button", { name: "Follow artwork" }).click();
          await expect(page.getByRole("status").last()).toHaveText(
            "Artwork followed.",
          );
          await page.getByRole("button", { name: "Download artwork" }).click();
          await expect(page.getByRole("status").last()).toHaveText(
            "Artwork downloaded.",
          );
          await page
            .getByRole("textbox", { name: "Query name" })
            .fill("Night collection");
          await object.getByRole("button", { name: "Run query" }).focus();
          await page.keyboard.press("Enter");
          await expect(page.getByRole("status").last()).toHaveText(
            "Query Night collection run.",
          );
          await panel
            .getByRole("button", { name: "Refresh resources" })
            .focus();
          await expect(
            page.getByRole("tooltip", { name: "Refresh", exact: true }),
          ).toBeVisible();
          await page.keyboard.press("Escape");
          await page.keyboard.press("Enter");
          await expect(page.getByRole("status").last()).toHaveText(
            "Resources refreshed.",
          );
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
}
test("new surface entries have live English docs and stable categories", async ({
  page,
}) => {
  const index = await (await page.request.get("/index.json")).json();
  for (const id of ["card", "instrumentpanel", "separator"]) {
    expect(index.entries[`components-${id}--docs`].title).toContain(
      "Components/Layout/",
    );
    await page.goto(`/iframe.html?id=components-${id}--docs&viewMode=docs`);
    await expect(page.getByRole("region", { name: /^Entry:/ })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Contract", exact: true }),
    ).toBeVisible();
  }
});
for (const width of [390, 1200])
  test(`actual OpsPanel consumer ${width} adopts the ruled contract`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto("http://127.0.0.1:5186/admin-analysis-demo.html");
    const panel = page.getByRole("region", {
      name: "Pipeline coverage",
      exact: true,
    });
    await expect(panel).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(panel).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(panel).toHaveCSS("border-top-width", "1px");
    await expect(panel).toHaveCSS("border-right-width", "0px");
    await expect(panel).toHaveCSS("box-shadow", "none");
    await expect(panel).toHaveCSS("backdrop-filter", "none");
    await expect(
      panel.getByRole("heading", { level: 2, name: "Pipeline coverage" }),
    ).toHaveCSS("font-family", /JetBrains/);
    await expect(
      panel.getByRole("heading", { level: 2, name: "Pipeline coverage" }),
    ).toHaveCSS("font-size", "11px");
    const actions = page
      .getByRole("region", { name: "Portable library state", exact: true })
      .locator('[data-slot="instrument-panel-actions"]');
    const buttons = actions.getByRole("button");
    await expect(buttons).toHaveCount(4);
    const boxes = await buttons.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }),
    );
    for (let index = 1; index < boxes.length; index++) {
      const first = boxes[index - 1]!;
      const second = boxes[index]!;
      const gap =
        Math.abs(first.y - second.y) < 1
          ? second.x - first.x - first.width
          : second.y - first.y - first.height;
      expect(gap).toBeGreaterThanOrEqual(7.9);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
test("object geometry agrees with the independent approved mockup frame", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5186/#paneles");
  const frame = page.locator(".specimen-grid").first();
  await expect(frame).toHaveCSS("background-color", "rgb(13, 14, 20)");
  await expect(frame).toHaveCSS("border-radius", "14px");
  const panel = page.locator('#paneles [data-slot="instrument-panel"]').first();
  await expect(panel).toHaveCSS("padding-top", "22px");
  await expect(
    panel.locator('[data-slot="instrument-panel-header"]'),
  ).toHaveCSS("margin-bottom", "20px");
});
