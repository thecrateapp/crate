import { expect, test, type Page } from "@playwright/test";
async function choose(page: Page, name: string, value: string) {
  await page.getByRole("combobox", { name, exact: true }).click();
  await page.getByRole("option", { name: value, exact: true }).click();
}
async function checkFields(page: Page) {
  // Measure after the modal's entrance scale has finished; the real gap remains 8px.
  await expect
    .poll(async () =>
      page
        .locator('[data-slot="form-field"][data-layout="stacked"]:visible')
        .evaluateAll((fields) =>
          Math.max(
            ...fields.map((field) => {
              const label = field.querySelector(
                '[data-slot="form-field-label"]',
              )!;
              const control = Array.from(field.children).find(
                (child) => child !== label,
              )!;
              return Math.abs(
                control.getBoundingClientRect().top -
                  label.getBoundingClientRect().bottom -
                  8,
              );
            }),
          ),
        ),
    )
    .toBeLessThan(0.01);
  const fields = await page
    .locator('[data-slot="form-field"]:visible')
    .evaluateAll((fields) =>
      fields.map((field) => {
        const label = field.querySelector('[data-slot="form-field-label"]')!;
        const control = Array.from(field.children).find(
          (child) => child !== label,
        )!;
        return {
          layout: field.getAttribute("data-layout"),
          gap:
            control.getBoundingClientRect().top -
            label.getBoundingClientRect().bottom,
          transform: getComputedStyle(label.querySelector("span")!)
            .textTransform,
          font: getComputedStyle(label.querySelector("span")!).fontFamily,
        };
      }),
    );
  expect(fields.length).toBeGreaterThan(1);
  for (const field of fields) {
    if (field.layout === "stacked") expect(field.gap).toBeCloseTo(8, 1);
    expect(field.transform).toBe("uppercase");
    expect(field.font).toContain("JetBrains");
  }
}
for (const host of ["storybook", "standalone"] as const) {
  for (const width of [375, 1200]) {
    test(`${host} collection detail/editor composition ${width}px`, async ({
      page,
    }) => {
      test.setTimeout(60000);
      await page.setViewportSize({ width, height: 1000 });
      const errors: string[] = [],
        apiRequests: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/"))
          apiRequests.push(request.url());
      });
      await page.goto(
        host === "storybook"
          ? "/iframe.html?id=reviews-1bb-collection-details--complete&viewMode=story"
          : "http://127.0.0.1:5186/review-1bb-collection-details.html",
      );
      await expect(
        page.getByRole("heading", { name: "Night collection", exact: true }),
      ).toHaveCSS("font-family", /Bricolage/, { timeout: 30000 });
      await checkFields(page);
      const cover = page
        .getByRole("row", { name: "Night music", exact: true })
        .locator('[data-slot="media-cover"]');
      expect((await cover.boundingBox())?.width).toBe(48);
      await page
        .getByRole("button", { name: "Play Night music", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Pause Night music", exact: true }),
      ).toBeVisible();
      const filter = page.getByRole("searchbox");
      await filter.fill("Chelsea");
      await expect(
        page.getByRole("row", { name: "Morning", exact: true }),
      ).toHaveCount(0);
      await filter.fill("");
      for (const kind of ["curated", "generated", "crate"]) {
        await page.getByRole("tab", { name: kind, exact: true }).click();
        await expect(
          page.getByRole("heading", { name: "Night collection", exact: true }),
        ).toBeVisible();
      }
      await expect(
        page.getByRole("heading", { name: "The records", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("searchbox")).toHaveCount(0);
      const crateRow = page
        .locator('[data-slot="crate-album-list"] li')
        .first();
      const background = await crateRow.evaluate(
        (el) => getComputedStyle(el).backgroundColor,
      );
      await crateRow.hover();
      await expect(crateRow).not.toHaveCSS("background-color", background);
      const playlistRow = page
        .getByText("Evening playlist", { exact: true })
        .locator('xpath=ancestor::*[@data-slot="entity-row"]');
      await page.mouse.move(0, 0);
      const playlistBackground = await playlistRow.evaluate(
        (el) => getComputedStyle(el).backgroundColor,
      );
      await playlistRow.hover();
      await expect(playlistRow).not.toHaveCSS(
        "background-color",
        playlistBackground,
      );
      await expect(page.getByTestId("crate-coverflow-frame")).toHaveCSS(
        "height",
        width < 640 ? "304px" : "400px",
      );
      await page
        .getByRole("button", { name: "Open playlist editor", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Edit playlist", exact: true }),
      ).toBeVisible();
      await checkFields(page);
      await page.getByRole("button", { name: "Playlist", exact: true }).click();
      await expect(
        page.getByRole("textbox", { name: "Playlist", exact: true }),
      ).toBeFocused();
      await page
        .getByRole("textbox", { name: "Playlist", exact: true })
        .fill("Edited Night collection");
      await page
        .getByRole("searchbox", { name: "Search tracks to add", exact: true })
        .fill("new");
      await page
        .getByRole("button", { name: "Add: New track", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Remove New track", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Remove New track", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Cancel", exact: true }),
      ).toBeDisabled();
      await expect(page.getByLabel("Fixture action")).toHaveText(
        "Playlist saved: Edited Night collection",
      );
      await page
        .getByRole("button", { name: "Open crate editor", exact: true })
        .click();
      await checkFields(page);
      const nameInput = page.getByRole("textbox", {
        name: "Name",
        exact: true,
      });
      const select = page.getByRole("combobox", {
        name: "Visibility",
        exact: true,
      });
      await expect(nameInput).toHaveCSS("height", "40px");
      await expect(select).toHaveCSS("height", "40px");
      await choose(page, "Ordering", "Ascending");
      const up = page.getByRole("button", {
        name: "Move A record up",
        exact: true,
      });
      await expect(up).toBeDisabled();
      await expect(up).toHaveCSS("width", "44px");
      await page
        .getByRole("button", { name: "Move A record down", exact: true })
        .click();
      await expect(up).toBeEnabled();
      await page
        .getByRole("button", { name: "Remove Night collection", exact: true })
        .click();
      await expect(
        page.getByRole("button", {
          name: "Remove Night collection",
          exact: true,
        }),
      ).toHaveCount(0);
      await page
        .getByRole("searchbox", { name: "Search albums", exact: true })
        .fill("New");
      await page.getByRole("button", { name: /Add New record/ }).click();
      await expect(
        page.getByRole("button", { name: "Remove New record", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Delete crate", exact: true })
        .click();
      await expect(
        page.getByRole("alertdialog", { name: "Delete crate?" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Cancel", exact: true })
        .last()
        .click();
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await expect(page.getByLabel("Fixture action")).toContainText(
        '"is_ordered":true',
      );
      await page
        .getByRole("button", { name: "Open collaborators", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Remove Jane McKay", exact: true })
        .click();
      await page
        .getByRole("searchbox", {
          name: "Search people by name or username",
          exact: true,
        })
        .fill("Jane");
      await page
        .getByRole("button", {
          name: "Add Jane McKay as a collaborator",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("link", { name: "Jane McKay", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await choose(page, "Access", "collaborator");
      await page
        .getByRole("button", { name: "Open crate editor", exact: true })
        .click();
      await expect(
        page.getByRole("combobox", { name: "Visibility", exact: true }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page
        .getByRole("button", { name: "Open collaborators", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Remove Jane McKay", exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole("button", { name: "Leave collection", exact: true })
        .click();
      await expect(
        page.getByRole("alertdialog", {
          name: "Leave collection?",
          exact: true,
        }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await page
        .getByRole("button", { name: "Leave collection", exact: true })
        .click();
      await page.getByRole("button", { name: "Leave", exact: true }).click();
      await expect(page.getByLabel("Fixture action")).toHaveText(
        "Left collection in fixture",
      );
      await choose(page, "Access", "viewer");
      await expect(
        page.getByRole("button", { name: "Open playlist editor", exact: true }),
      ).toBeDisabled();
      await choose(page, "Read state", "loading");
      await expect(page.getByTestId("loading-state")).toBeVisible();
      await choose(page, "Read state", "error");
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(page.getByTestId("crate-coverflow-frame")).toBeVisible();
      await choose(page, "Read state", "empty");
      await expect(
        page.getByText("0 albums", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Play", exact: true }),
      ).toBeDisabled();
      await choose(page, "Access", "owner");
      await choose(page, "Editor mode", "Create");
      await page
        .getByRole("button", { name: "Open crate editor", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Create crate", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Save changes", exact: true }),
      ).toBeDisabled();
      await expect(page.getByRole("searchbox")).toHaveCount(0);
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page
        .getByRole("button", { name: "Open playlist editor", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Create playlist", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(
          "Start by searching for tracks or open this modal from an album or track menu.",
          { exact: true },
        ),
      ).toBeVisible();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(apiRequests).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}
