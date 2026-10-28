import { expect, test } from "@playwright/test";

for (const host of ["storybook", "standalone"] as const) {
  for (const width of [1200, 640, 375]) {
    test(`${host} Home signals at ${width}px preserve canonical layout and metadata`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(
        host === "storybook"
          ? "/iframe.html?id=listen-home-signals--complete&viewMode=story"
          : "http://127.0.0.1:5186/review-1be-home-signals.html",
      );
      await expect(
        page.getByRole("heading", { name: "Radar", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Crate DNA", exact: true }),
      ).toBeVisible();
      await expect(
        page.locator('[data-home-slot="radar-feature"]'),
      ).toHaveAttribute("data-slot", "card");
      expect(
        (await page.locator('[data-home-slot="radar-feature"]').boundingBox())!
          .height,
      ).toBeLessThan(480);
      await expect(
        page.locator('[data-home-slot="dna-summary"]'),
      ).toHaveAttribute("data-slot", "card");
      for (const text of [
        "Next show",
        "Next up",
        "Replay October 2026",
        "Month replay",
      ]) {
        await expect(page.getByText(text, { exact: true })).toHaveCSS(
          "font-family",
          /JetBrains/,
        );
        await expect(page.getByText(text, { exact: true })).toHaveCSS(
          "text-transform",
          "uppercase",
        );
      }
      const group = page.getByRole("group", {
        name: "Sidebar · primary and Collection links",
        exact: true,
      });
      const nav = group.getByRole("navigation");
      const explore = nav.getByRole("link", { name: "Explore", exact: true });
      await expect(explore).toHaveCSS("min-height", "44px");
      const label = explore.locator(".crate-mono-label");
      await expect(label).toHaveCSS("text-transform", "uppercase");
      await explore.hover();
      await expect(label).toHaveCSS("color", "rgb(103, 232, 249)");
      await expect(
        nav.getByRole("button", { name: "Collection", exact: true }),
      ).toHaveAttribute("aria-expanded", "true");
      await expect(
        nav.getByRole("link", { name: "Albums", exact: true }),
      ).toBeVisible();
      const sample = page.getByTestId("stable-track-metadata");
      const rows = sample.getByRole("row");
      await expect(rows).toHaveCount(4);
      const columns = await rows.evaluateAll((nodes) =>
        nodes.map((row) => {
          const rect = row.getBoundingClientRect();
          const cells = [
            ...row.querySelectorAll<HTMLElement>("[data-track-slot]"),
          ];
          return {
            width: rect.width,
            right: rect.right,
            cells: cells.map((cell) => ({
              name: cell.dataset.trackSlot,
              x: cell.getBoundingClientRect().x,
              width: cell.getBoundingClientRect().width,
              display: getComputedStyle(cell).display,
            })),
            bpm: row.querySelector(".crate-track-bpm")?.getBoundingClientRect()
              .right,
            key: row.querySelector(".crate-track-key")?.getBoundingClientRect()
              .x,
          };
        }),
      );
      for (const row of columns) {
        expect(row.cells.map((cell) => cell.name)).toEqual([
          "quality",
          "analysis",
          "duration",
          "like",
          "actions",
        ]);
        for (const [index, cell] of row.cells.entries()) {
          expect(cell.x).toBeCloseTo(columns[0]!.cells[index]!.x, 1);
          expect(cell.width).toBeCloseTo(columns[0]!.cells[index]!.width, 1);
          expect(cell.x + cell.width).toBeLessThanOrEqual(row.right + 1);
        }
      }
      if (columns[0]!.cells[1]!.display !== "none") {
        expect(columns[0]!.bpm).toBeCloseTo(columns[1]!.bpm!, 1);
        expect(columns[0]!.key).toBeCloseTo(columns[1]!.key!, 1);
      }
      await page
        .getByRole("button", { name: "Play month replay", exact: true })
        .click();
      await expect(
        page.getByRole("status", { name: "Fixture action" }),
      ).toContainText("Play month replay");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      ).toBe(false);
    });
  }
  test(`${host} Radar single, empty and released states remain useful`, async ({
    page,
  }) => {
    await page.goto(
      host === "storybook"
        ? "/iframe.html?id=listen-home-signals--complete&viewMode=story"
        : "http://127.0.0.1:5186/review-1be-home-signals.html",
    );
    async function scenario(name: string) {
      await page
        .getByRole("combobox", { name: "Scenario", exact: true })
        .click();
      await page.getByRole("option", { name, exact: true }).click();
    }
    await scenario("single");
    await expect(page.locator('[data-home-slot="radar-list"]')).toHaveCount(0);
    await scenario("empty");
    await expect(
      page.getByRole("heading", {
        name: "Follow some artists to unlock Radar",
      }),
    ).toBeVisible();
    await scenario("no-signals");
    await expect(
      page.getByRole("heading", { name: "No new Radar signals yet" }),
    ).toBeVisible();
    await scenario("released");
    await expect(
      page.locator(
        '[data-home-slot="radar-feature"] [data-slot="upcoming-timing"]',
      ),
    ).toHaveText("Released");
    await expect(
      page.getByRole("link", { name: "Open album", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Open Radar", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("status", { name: "Fixture action" }),
    ).toContainText("Open Radar");
  });
}
