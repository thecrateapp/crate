import { expect, test } from "@playwright/test";

test.describe("hero", () => {
  test("never shows the static mark before the particle field", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "commit" });
    await page.waitForSelector(".mark-static", { state: "attached" });
    const samples: string[] = [];
    for (let i = 0; i < 20; i++) {
      samples.push(
        await page
          .locator(".mark-static")
          .evaluate((element) => getComputedStyle(element).opacity),
      );
      await page.waitForTimeout(100);
    }
    expect(new Set(samples)).toEqual(new Set(["0"]));
    await expect(page.locator("canvas#field")).toHaveCount(1);
  });

  test("shows a scroll cue that fades once the visitor scrolls", async ({
    page,
  }) => {
    await page.goto("/");
    const cue = page.locator(".scroll-cue");
    await expect(cue).toHaveCSS("opacity", "1", { timeout: 5000 });

    await page.evaluate(() => scrollTo(0, 200));
    await expect(cue).toHaveCSS("opacity", "0");

    await page.evaluate(() => scrollTo(0, 0));
    await expect(cue).toHaveCSS("opacity", "1");
  });

  test("leads the top navigation with the manifesto", async ({ page }) => {
    await page.goto("/");
    const first = page.locator(".nav .links a").first();
    await expect(first).toHaveAttribute("href", "/why");
    await expect(first).toHaveClass(/is-accent/);
  });

  test("shows the static mark when WebGL2 is unavailable", async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (type === "webgl2") return null;
        return original.call(this, type as "2d", ...(rest as []));
      } as typeof original;
    });
    await page.goto("/");

    await expect(page.locator(".mark-static")).toHaveCSS("opacity", "1", {
      timeout: 5000,
    });
  });

  test("falls back to the static mark while the WebGL context is lost", async ({
    page,
  }) => {
    await page.goto("/");
    const mark = page.locator(".mark-static");
    await expect(mark).toHaveCSS("opacity", "0", { timeout: 5000 });

    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>("#field")!;
      const ext = canvas
        .getContext("webgl2")!
        .getExtension("WEBGL_lose_context")!;
      (window as unknown as { lose: WEBGL_lose_context }).lose = ext;
      ext.loseContext();
    });
    await expect(mark).toHaveCSS("opacity", "1");
    await expect(page.locator("canvas#field")).toHaveCSS(
      "visibility",
      "hidden",
    );

    await page.evaluate(() =>
      (window as unknown as { lose: WEBGL_lose_context }).lose.restoreContext(),
    );
    await expect(page.locator("canvas#field")).toHaveCSS(
      "visibility",
      "visible",
    );
    await expect(mark).toHaveCSS("opacity", "0");
  });

  test.describe("reduced motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("keeps the static mark and leaves the words in place", async ({
      page,
    }) => {
      await page.goto("/");
      await page.waitForTimeout(3000);

      await expect(page.locator(".mark-static")).toBeVisible();
      await expect(page.locator(".mark-static")).toHaveCSS("opacity", "1");
      const words = page.locator(".hero-copy .w");
      expect(await words.count()).toBeGreaterThan(0);
      const transforms = await words.evaluateAll((elements) =>
        elements.map((element) => getComputedStyle(element).transform),
      );
      expect(new Set(transforms)).toEqual(new Set(["none"]));
    });
  });

  test.describe("install command", () => {
    test.use({ permissions: ["clipboard-read", "clipboard-write"] });

    test("copies the install command to the clipboard", async ({ page }) => {
      await page.goto("/");
      const button = page.locator(".hero-copy [data-copy]");
      const command = await button.getAttribute("data-copy");

      await button.click();

      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe(command);
      await expect(button.locator(".pill")).toHaveText("Copied");
    });
  });

  test("keeps the copy label and selects the command when the clipboard refuses", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      navigator.clipboard.writeText = () =>
        Promise.reject(new DOMException("denied", "NotAllowedError"));
    });
    await page.goto("/");
    const button = page.locator(".hero-copy [data-copy]");
    const command = await button.getAttribute("data-copy");

    await button.click();

    await expect
      .poll(() => page.evaluate(() => getSelection()?.toString()))
      .toBe(command);
    await page.waitForTimeout(500);
    await expect(button.locator(".pill")).toHaveText("Copy");
  });
});
