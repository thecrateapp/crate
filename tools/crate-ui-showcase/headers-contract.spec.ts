import { expect, test } from "@playwright/test";
for (const host of ["preview", "storybook"]) {
  for (const width of [390, 1200]) {
    for (const coarse of [false, true]) {
      test.describe(`${host} ${width}px ${coarse ? "coarse" : "fine"}`, () => {
        test.use({ viewport: { width, height: 1100 }, hasTouch: coarse });
        test("header families keep typography, composition and native actions", async ({
          page,
        }) => {
          const errors: string[] = [];
          const api: string[] = [];
          page.on("pageerror", (error) => errors.push(error.message));
          page.on("request", (request) => {
            if (new URL(request.url()).pathname.startsWith("/api/"))
              api.push(request.url());
          });
          await page.goto(
            host === "preview"
              ? "http://127.0.0.1:5186/review-1au-headers.html"
              : "/iframe.html?id=reviews-1au-headers--complete&viewMode=story",
          );
          await expect(
            page.getByRole("heading", {
              name: "Identity, context and actions.",
            }),
          ).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          const pageGroup = page.getByRole("group", {
            name: "PageHeader · artwork and metadata",
            exact: true,
          });
          const title = pageGroup.getByRole("heading", {
            name: "Costa de noche",
            exact: true,
          });
          await expect(title).toHaveCSS("font-family", /Bricolage Grotesque/);
          await expect(title).toHaveCSS("font-size", "30px");
          await expect(title).toHaveCSS("font-weight", "600");
          await expect(
            pageGroup.getByText(
              "A playlist keeps its identity alongside compact actions.",
            ),
          ).toHaveCSS("font-family", /IBM Plex Sans/);
          await expect(pageGroup.getByText("smart", { exact: true })).toHaveCSS(
            "text-transform",
            "none",
          );
          await expect(pageGroup.getByText("0 followers")).toBeVisible();
          const save = pageGroup.getByRole("button", {
            name: "Save Costa de noche",
          });
          await expect(save).toHaveCSS("width", "44px");
          const boxes = await pageGroup.evaluate((element) => {
            const artwork = element
              .querySelector('[aria-label="Playlist cover"]')!
              .getBoundingClientRect();
            const identity = element
              .querySelector('[data-slot="page-header-identity"]')!
              .getBoundingClientRect();
            const actions = element
              .querySelector('[data-slot="header-actions-position"]')!
              .getBoundingClientRect();
            return {
              artwork: { x: artwork.x, y: artwork.y, width: artwork.width },
              identity: { x: identity.x, y: identity.y, width: identity.width },
              actions: { x: actions.x, y: actions.y, bottom: actions.bottom },
            };
          });
          expect(boxes.artwork.width).toBe(112);
          if (width === 1200) {
            expect(boxes.actions.y).toBeCloseTo(boxes.artwork.y, 1);
            expect(boxes.identity.y).toBeCloseTo(boxes.artwork.y, 1);
            expect(boxes.actions.x).toBeGreaterThan(
              boxes.identity.x + boxes.identity.width - 1,
            );
          } else
            expect(boxes.actions.bottom).toBeLessThanOrEqual(boxes.artwork.y);
          const narrow = page.getByRole("region", {
            name: "Narrow page header",
          });
          const narrowTitle = narrow.getByRole("heading");
          const narrowAction = narrow.getByRole("button", {
            name: "Edit collection",
          });
          expect(
            (await narrowAction.boundingBox())!.y + 44,
          ).toBeLessThanOrEqual((await narrowTitle.boundingBox())!.y);
          await expect(narrowTitle).toHaveCSS("font-size", "24px");
          for (const field of await page
            .locator('[data-slot="form-field"]')
            .all()) {
            const gap = await field.evaluate((element) => {
              const label = element.querySelector(
                '[data-slot="form-field-label"]',
              )!;
              return (
                label.nextElementSibling!.getBoundingClientRect().top -
                label.getBoundingClientRect().bottom
              );
            });
            expect(gap).toBeCloseTo(8, 1);
          }
          const section = page.getByRole("region", { name: "Section headers" });
          await expect(
            section.getByRole("heading", { name: "Recent albums" }),
          ).toHaveCSS("font-family", /Bricolage Grotesque/);
          await expect(
            section.getByRole("heading", { name: "Recent albums" }),
          ).toHaveCSS("font-size", "18px");
          await expect(
            section.getByTestId("section-header-count").first(),
          ).toHaveCSS("font-family", /JetBrains/);
          await expect(
            section.getByTestId("section-header-count").first(),
          ).toHaveText("0");
          for (const name of [
            "Media story",
            "Artist story",
            "Editorial story",
            "Card story",
          ])
            await expect(
              page.getByRole("heading", { name, exact: true }),
            ).toHaveCSS("font-family", /Bricolage Grotesque/);
          const longHero = page
            .getByRole("region", { name: "Compact media hero" })
            .getByTestId("page-hero");
          const longTitle = longHero.getByRole("heading");
          await expect(longTitle).toHaveCSS(
            "font-size",
            width === 390 ? "24px" : "36px",
          );
          const longBox = await longTitle.boundingBox();
          const heroBox = await longHero.boundingBox();
          expect(longBox!.y).toBeGreaterThanOrEqual(heroBox!.y);
          expect(longBox!.y + longBox!.height).toBeLessThanOrEqual(
            heroBox!.y + heroBox!.height,
          );
          await expect(
            page
              .getByRole("region", { name: "Content-sized media hero" })
              .getByRole("region", { name: "Empty collection", exact: true }),
          ).toHaveCSS("min-height", "0px");
          const back = page.getByRole("button", {
            name: "Previous view",
            exact: true,
          });
          await expect(back).toHaveCSS("width", coarse ? "44px" : "40px");
          await expect(back).toHaveCSS("height", coarse ? "44px" : "40px");
          await pageGroup
            .getByRole("link", { name: "Back to playlists", exact: true })
            .focus();
          await page.keyboard.press("Enter");
          await expect(
            page.getByRole("status", { name: "Current route" }),
          ).toHaveText("/collection?tab=playlists");
          await save.click();
          await expect(save).toBeDisabled();
          await expect(save).toHaveAttribute("aria-busy", "true");
          await page
            .getByRole("button", { name: "Complete save", exact: true })
            .click();
          await expect(save).toBeEnabled();
          const result = page.getByRole("status", { name: "Action result" });
          await expect(result).toHaveText("Playlist saved.");
          const play = page.getByRole("button", {
            name: "Play collection",
            exact: true,
          });
          expect((await play.boundingBox())!.height).toBeGreaterThanOrEqual(48);
          expect(
            await play.evaluate(
              (element) => element.scrollHeight <= element.clientHeight,
            ),
          ).toBe(true);
          await play.click();
          await expect(play).toBeDisabled();
          await expect(result).toHaveText("Preparing playback.");
          await page
            .getByRole("button", { name: "Complete playback", exact: true })
            .click();
          await page
            .getByRole("button", { name: "Follow", exact: true })
            .click();
          await expect(
            page.getByRole("button", { name: "Follow", exact: true }),
          ).toHaveAttribute("aria-pressed", "true");
          await expect(
            page.getByRole("button", { name: "Download", exact: true }),
          ).toBeDisabled();
          const translated = page.getByRole("button", {
            name: "A translated action label remains fully readable",
            exact: true,
          });
          expect(
            await translated
              .locator("span")
              .evaluate(
                (element) => element.scrollWidth <= element.clientWidth,
              ),
          ).toBe(true);
          await page.getByRole("button", { name: "More", exact: true }).click();
          await page.getByText("Share collection", { exact: true }).click();
          await expect(result).toHaveText("Collection shared.");
          await page.keyboard.press("Escape");
          await back.click();
          await expect(result).toHaveText("Previous view requested.");
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
test("all five header families have English live catalogue docs", async ({
  page,
}) => {
  const index = await (await page.request.get("/index.json")).json();
  for (const [id, category] of [
    ["pageheader", "Layout"],
    ["sectionheader", "Layout"],
    ["pagehero", "Layout"],
    ["heroactionbar", "Actions"],
    ["backlink", "Navigation"],
  ] as const) {
    expect(index.entries[`components-${id}--docs`].title).toBe(
      `Components/${category}/${
        id === "pageheader"
          ? "PageHeader"
          : id === "sectionheader"
            ? "SectionHeader"
            : id === "pagehero"
              ? "PageHero"
              : id === "heroactionbar"
                ? "HeroActionBar"
                : "BackLink"
      }`,
    );
    await page.goto(`/iframe.html?id=components-${id}--docs&viewMode=docs`);
    await expect(
      page.getByRole("heading", { name: "Contract", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: /^Entry:/ })).toBeVisible();
  }
});
test("mobile production hero menu keeps a single portalled trigger", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(
    "/iframe.html?id=components-heroactionbar--mobile-portal&viewMode=story",
  );
  const trigger = page.getByRole("button", { name: "More", exact: true });
  await expect(trigger).toHaveCount(1);
  await expect(trigger).toHaveAttribute(
    "data-testid",
    "hero-mobile-menu-trigger",
  );
  expect(
    await trigger.evaluate(
      (element) => !element.closest('[data-testid="hero-action-bar"]'),
    ),
  ).toBe(true);
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("header body roles follow the existing native font variable without changing display titles", async ({
  page,
}) => {
  await page.goto(
    "/iframe.html?id=reviews-1au-headers--complete&viewMode=story",
  );
  await expect(
    page.getByRole("heading", { name: "Identity, context and actions." }),
  ).toBeVisible();
  await page.evaluate(() =>
    document.documentElement.style.setProperty("--font-brand", "system-ui"),
  );
  await expect(
    page.getByText("A playlist keeps its identity alongside compact actions."),
  ).toHaveCSS("font-family", "system-ui");
  await expect(
    page.getByRole("heading", { name: "Costa de noche", exact: true }),
  ).toHaveCSS("font-family", /Bricolage Grotesque/);
  await expect(page.getByTestId("hero-action-bar")).toHaveCSS(
    "font-family",
    "system-ui",
  );
});

for (const width of [390, 1200]) {
  test(`real editor failed metadata keeps its group spacing ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto("http://127.0.0.1:5186/admin-playlist-editor-demo.html");
    await page
      .getByRole("radio", { name: "Generación fallida", exact: true })
      .click();
    const error = page
      .getByText("Fallo de generación de muestra. Puedes reintentar.", {
        exact: true,
      })
      .first();
    await expect(error).toBeVisible();
    const gap = await error.evaluate(
      (element) =>
        element.getBoundingClientRect().top -
        element.previousElementSibling!.getBoundingClientRect().bottom,
    );
    expect(gap).toBeCloseTo(16, 1);
  });
  test(`page header groups fragment actions without caller repairs ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto(
      "/iframe.html?id=components-pageheader--fragment-actions&viewMode=story",
    );
    const first = page.getByRole("button", {
      name: "Export collection",
      exact: true,
    });
    const second = page.getByRole("button", { name: "Copy link", exact: true });
    await expect(first).toBeVisible();
    const a = (await first.boundingBox())!,
      b = (await second.boundingBox())!;
    expect(
      Math.abs(a.y - b.y) < 1 ? b.x - a.x - a.width : b.y - a.y - a.height,
    ).toBeGreaterThanOrEqual(7.9);
  });
}

for (const width of [390, 1200]) {
  test(`hero content sizing preserves short empty collection geometry ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(
      "/iframe.html?id=components-pagehero--content-height&viewMode=story",
    );
    const hero = page.getByRole("region", {
      name: "Empty collection",
      exact: true,
    });
    await expect(hero).toBeVisible();
    await expect(hero).toHaveCSS("min-height", "0px");
    expect((await hero.boundingBox())!.height).toBeLessThan(300);
  });
  test(`hero actions stay within a narrow container on a wide viewport ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(
      "/iframe.html?id=components-heroactionbar--long-content&viewMode=story",
    );
    const bar = page.getByTestId("hero-action-bar");
    await expect(bar).toBeVisible();
    const outer = (await bar.boundingBox())!;
    for (const button of await bar.getByRole("button").all()) {
      const bounds = (await button.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(outer.x);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(
        outer.x + outer.width + 0.1,
      );
    }
  });
}

test("unbroken secondary labels stay inside their bounded action group", async ({
  page,
}) => {
  await page.goto(
    "/iframe.html?id=components-heroactionbar--unbroken-actions&viewMode=story",
  );
  const bar = page.getByTestId("hero-action-bar");
  const button = bar.getByRole("button");
  await expect(button).toBeVisible();
  const a = (await bar.boundingBox())!,
    b = (await button.boundingBox())!;
  expect(b.x + b.width).toBeLessThanOrEqual(a.x + a.width + 0.1);
  expect(
    await button
      .locator("span")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
});
