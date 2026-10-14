import { expect, test } from "@playwright/test";

const PAGES = [
  "/",
  "/listen",
  "/admin",
  "/architecture",
  "/developers",
  "/why",
];
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];
const PENDING_ASSETS = ["/data/library-cloud.json"];

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    for (const path of PAGES) {
      test(`${path} renders without errors or horizontal overflow`, async ({
        page,
      }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (message.type() !== "error") return;
          const url = message.location().url;
          if (url && PENDING_ASSETS.includes(new URL(url).pathname)) return;
          errors.push(message.text());
        });

        const response = await page.goto(path, { waitUntil: "networkidle" });

        expect(response?.status()).toBe(200);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
        expect(errors).toEqual([]);
      });
    }
  });
}
