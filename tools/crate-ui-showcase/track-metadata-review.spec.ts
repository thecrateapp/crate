import { expect, test } from "@playwright/test";

const hosts = [
  {
    name: "storybook",
    url: "/iframe.html?id=reviews-1ba-album-access--complete&viewMode=story",
  },
  {
    name: "standalone",
    url: "http://127.0.0.1:5186/review-1ba-album-access.html",
  },
];
for (const host of hosts) {
  for (const width of [1200, 900, 760, 640, 375]) {
    test(`${host.name} metadata at ${width}px retains columns without clipping`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(host.url);
      const list = page.getByRole("list", {
        name: "Track metadata alignment",
        exact: true,
      });
      await expect(list.getByRole("listitem")).toHaveCount(5);
      const rows = list.getByRole("listitem");
      const metrics = await rows.evaluateAll((elements) =>
        elements.map((row) => {
          const rect = row.getBoundingClientRect();
          return {
            width: rect.width,
            right: rect.right,
            durationSize: getComputedStyle(
              row.querySelector('[data-track-slot="duration"]')!,
            ).fontSize,
            durationFits:
              row.querySelector('[data-track-slot="duration"]')!.scrollWidth <=
              row.querySelector('[data-track-slot="duration"]')!.clientWidth +
                1,
            cells: Array.from(
              row.querySelectorAll<HTMLElement>("[data-track-slot]"),
            ).map((el) => ({
              slot: el.dataset.trackSlot,
              text: el.textContent,
              x: el.getBoundingClientRect().x,
              right: el.getBoundingClientRect().right,
              width: el.getBoundingClientRect().width,
              visible: getComputedStyle(el).display !== "none",
            })),
            badge: row.querySelector<HTMLElement>("[data-quality-tier]")
              ? {
                  icon: !!row.querySelector("[data-quality-tier] svg"),
                  tier: row
                    .querySelector("[data-quality-tier]")!
                    .getAttribute("data-quality-tier"),
                  clipped: Array.from(
                    row.querySelectorAll<HTMLElement>(
                      "[data-quality-tier], [data-quality-tier] span",
                    ),
                  ).some((el) => el.scrollWidth > el.clientWidth + 1),
                  height: row
                    .querySelector("[data-quality-tier]")!
                    .getBoundingClientRect().height,
                }
              : null,
            tempoRight: row
              .querySelector(".crate-track-bpm")
              ?.getBoundingClientRect().right,
            keyX: row.querySelector(".crate-track-key")?.getBoundingClientRect()
              .x,
          };
        }),
      );
      for (const row of metrics) {
        expect(row.durationSize).toBe("12px");
        expect(row.durationFits).toBe(true);
        for (const cell of row.cells) {
          const first = metrics[0]!.cells.find(
            (other) => other.slot === cell.slot,
          )!;
          expect(cell.x).toBeCloseTo(first.x, 1);
          expect(cell.width).toBeCloseTo(first.width, 1);
          expect(cell.right).toBeLessThanOrEqual(row.right);
          if (cell.slot === "quality")
            expect(cell.visible).toBe(row.width - 24 >= 640);
          if (cell.slot === "analysis")
            expect(cell.visible).toBe(row.width - 24 >= 800);
        }
        if (row.badge && row.cells[0]!.visible) {
          expect(row.badge.icon).toBe(true);
          expect(row.badge.height).toBe(24);
          expect(row.badge.clipped).toBe(false);
        }
      }
      if (metrics[0]!.cells[1]!.visible) {
        expect(metrics[1]!.tempoRight).toBeCloseTo(metrics[0]!.tempoRight!, 1);
        expect(metrics[1]!.keyX).toBeCloseTo(metrics[0]!.keyX!, 1);
      }
      expect(metrics[0]!.badge?.tier).toBe("lossless");
      expect(metrics[1]!.badge?.tier).toBe("hi-res");
      expect(metrics[4]!.badge).toBeNull();
      expect(
        metrics[4]!.cells.find((cell) => cell.slot === "duration")!.text,
      ).toBe("");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      ).toBe(false);
    });
  }
}
