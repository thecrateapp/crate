import { expect, test, type Page } from "@playwright/test";

async function mountAll(page: Page, path: string) {
  await page.goto(path);
  const roots = page.locator("[data-viz]");
  const count = await roots.count();
  for (let i = 0; i < count; i++) {
    await roots.nth(i).scrollIntoViewIfNeeded();
    await expect(roots.nth(i)).toHaveAttribute("data-viz-ready", "");
  }
  return count;
}

test("every live visual on /listen mounts when it comes into view", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  expect(await mountAll(page, "/listen")).toBe(5);
  expect(errors).toEqual([]);
});

test("the Smart Mix strip never implies beat matching", async ({ page }) => {
  await page.goto("/listen");
  const text = (await page.locator(".mix").textContent()) ?? "";

  expect(text).toMatch(/Beat grid/);
  expect(text).not.toMatch(/lock|beatmatch|beat-match|sync|handoff|automix/i);
});

test("visuals load lazily instead of with the page", async ({ page }) => {
  await page.goto("/listen");

  await expect(page.locator("[data-viz='federation']")).not.toHaveAttribute(
    "data-viz-ready",
    "",
  );
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the equalizer and crossfade show their final state", async ({
    page,
  }) => {
    await page.goto("/listen");
    const eq = page.locator("[data-viz='eq']");
    await eq.scrollIntoViewIfNeeded();
    await expect(eq).toHaveAttribute("data-viz-ready", "");
    await expect(eq.locator("[data-eq-progress]")).toHaveCSS(
      "transform",
      /matrix\(1, 0, 0, 1/,
    );

    const mix = page.locator("[data-viz='mix']");
    await mix.scrollIntoViewIfNeeded();
    await expect(mix.locator("[data-gain='a']")).toHaveText("0.71");
  });
});
