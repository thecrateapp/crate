import { expect, test } from "@playwright/test";
for (const [host, url] of [
  [
    "storybook",
    "/iframe.html?id=reviews-1be-track-data--complete&viewMode=story",
  ],
  ["standalone", "http://127.0.0.1:5186/review-1be-track-data.html"],
])
  for (const width of [375, 1200]) {
    test(`${host} complete track data at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url!);
      await expect(
        page.getByRole("heading", { name: "Track data consistency" }),
      ).toBeVisible({ timeout: 15000 });
      const rows = page.locator(".track-row");
      await expect(rows).toHaveCount(8);
      const slots = await rows.evaluateAll((elements) =>
        elements.map((el) =>
          Array.from(el.querySelectorAll<HTMLElement>("[data-track-slot]")).map(
            (slot) => ({
              name: slot.dataset.trackSlot,
              x: slot.getBoundingClientRect().x,
              text: slot.textContent,
            }),
          ),
        ),
      );
      expect(slots[0]!.map((s) => s.name)).toEqual([
        "quality",
        "analysis",
        "duration",
        "like",
        "actions",
      ]);
      for (const row of slots.slice(0, 6)) {
        expect(row[0]!.text).toBe("Hi-Res 24/96");
        expect(row[1]!.text).toContain("99");
        expect(row[1]!.text).toContain("7A");
        expect(row[2]!.text).toBe("2:23");
        if (width === 1200)
          row.forEach((slot, index) =>
            expect(slot.x).toBeCloseTo(slots[0]![index]!.x, 1),
          );
      }
      expect(slots[6]![0]!.text).toBe("MP3 320");
      expect(slots[7]!.slice(0, 3).map((s) => s.text)).toEqual(["", "", ""]);
      await page
        .getByRole("button", { name: "Play Offline", exact: true })
        .click();
      await expect(page.locator("output")).toHaveText("Play Offline");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  }
