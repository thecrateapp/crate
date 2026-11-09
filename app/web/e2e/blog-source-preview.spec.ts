import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";

const article = "/blog/smart-mix-planned-on-the-server";
const commit = "cacf4b3471371b6cc68c7a3baf2a4a752f74626f";
const sourceHref = `https://github.com/thecrateapp/crate/blob/${commit}/app/crate/smart_mix/planner.py#L307-L316`;
const dialogSelector = "[data-github-preview-dialog]";

test("a code header opens the full pinned file at its highlighted lines and returns focus", async ({ page }) => {
  await page.goto(article);
  const link = page.locator(`.expressive-code a[href="${sourceHref}"]`);
  await link.click();
  const dialog = page.locator(dialogSelector);
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("data-state", "ready", { timeout: 15000 });
  await expect(dialog).toHaveAttribute("data-mode", "source");
  await expect(dialog.locator("[data-github-preview-title]")).toContainText("app/crate/smart_mix/planner.py");
  await expect(dialog.locator("[data-github-preview-commit]")).toContainText(commit.slice(0, 8));
  await expect(dialog.locator("[data-github-preview-open]")).toHaveAttribute("href", sourceHref);
  await expect(dialog.locator('[data-source-line][data-highlighted="true"]')).toHaveCount(10);
  await expect(dialog.locator('[data-source-line="307"]')).toBeInViewport();
  await expect(dialog.locator('[data-source-line="1"]')).toBeAttached();
  expect(await dialog.locator("[data-source-line]").count()).toBeGreaterThan(316);
  const expected = execFileSync("git", ["show", `${commit}:app/crate/smart_mix/planner.py`], { encoding: "utf8" })
    .split("\n").slice(306, 316);
  expect(await dialog.locator('[data-source-line][data-highlighted="true"] .gfp-line-code').allTextContents()).toEqual(expected);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(link).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`${article}$`));
});

test("snapshots store the text once and colour tokens through the shared theme classes", async ({ page, request }) => {
  await page.goto(article);
  await page.locator(`.expressive-code a[href="${sourceHref}"]`).click();
  const dialog = page.locator(dialogSelector);
  await expect(dialog).toHaveAttribute("data-state", "ready", { timeout: 15000 });
  await expect(dialog.locator(".gfp-line-code .gfp-c-67e8f9").first()).toHaveCSS("color", "rgb(103, 232, 249)");
  await expect(dialog.locator(".gfp-line-code .gfp-c-fbbf24").first()).toHaveCSS("color", "rgb(251, 191, 36)");
  await expect(dialog.locator(".gfp-code [style]")).toHaveCount(0);
  const snapshotHref = await page.locator("[data-github-preview-manifest]").evaluate((element, path) =>
    (JSON.parse(element.textContent ?? "[]") as { href: string; ref: string; path: string }[])
      .find((item) => item.path === path && item.ref !== "main")!.href, "app/crate/smart_mix/planner.py");
  const snapshot = await (await request.get(snapshotHref)).json();
  expect(snapshot).not.toHaveProperty("codeHtml");
  expect(snapshot.runs).toHaveLength(snapshot.source.replace(/\n$/, "").split("\n").length);
  expect(JSON.stringify(snapshot).length).toBeLessThan(snapshot.source.length * 2);
});

test("Markdown opens at its referenced heading and can switch to numbered source", async ({ page, request }) => {
  const href = "/blog/lyrics-as-labels";
  test.skip((await request.get(href)).status() === 404, "Review draft.");
  await page.goto(href);
  await page.locator('.prose a[href$="smart-mix-operations.md#voice-per-phrase"]').click();
  const dialog = page.locator(dialogSelector);
  await expect(dialog).toHaveAttribute("data-state", "ready", { timeout: 15000 });
  await expect(dialog).toHaveAttribute("data-mode", "rendered");
  await expect(dialog.locator('[data-source-heading="voice-per-phrase"]')).toBeInViewport();
  await dialog.locator('[data-github-preview-mode="source"]').click();
  await expect(dialog).toHaveAttribute("data-mode", "source");
  await expect(dialog.locator("[data-source-line]").first()).toBeAttached();
  await dialog.locator('[data-github-preview-mode="rendered"]').click();
  await expect(dialog.locator('[data-source-heading="voice-per-phrase"]')).toBeInViewport();
});

test("footer files resolve the build revision, while source links work without JavaScript", async ({ page, browser }) => {
  await page.goto(article);
  const footerLink = page.locator('.sources a[href="https://github.com/thecrateapp/crate/blob/main/app/crate/smart_mix/planner.py"]');
  await footerLink.click();
  const dialog = page.locator(dialogSelector);
  await expect(dialog).toHaveAttribute("data-state", "ready", { timeout: 15000 });
  await expect(dialog.locator("[data-github-preview-open]")).toHaveAttribute("href", /\/blob\/[0-9a-f]{40}\/app\/crate\/smart_mix\/planner.py/);
  await expect(dialog.locator("[data-github-preview-revision]")).toContainText("main");
  const context = await browser.newContext({ javaScriptEnabled: false });
  const staticPage = await context.newPage();
  await staticPage.goto(article);
  await expect(staticPage.locator(`.expressive-code a[href="${sourceHref}"]`)).toBeVisible();
  await expect(staticPage.locator(dialogSelector)).toBeHidden();
  await context.close();
});

test("a failed snapshot retains the exact GitHub destination and can be retried", async ({ page }) => {
  await page.goto(article);
  await page.route("**/blog/source/*.json", (route) => route.fulfill({ status: 503, body: "Unavailable" }), { times: 1 });
  await page.locator(`.expressive-code a[href="${sourceHref}"]`).click();
  const dialog = page.locator(dialogSelector);
  await expect(dialog).toHaveAttribute("data-state", "error");
  await expect(dialog.locator("[data-github-preview-open]")).toHaveAttribute("href", sourceHref);
  await expect(dialog.locator("[data-github-preview-status]")).not.toBeEmpty();
  await dialog.locator("[data-github-preview-close]").click();
  await page.locator(`.expressive-code a[href="${sourceHref}"]`).click();
  await expect(dialog).toHaveAttribute("data-state", "ready", { timeout: 15000 });
});

for (const width of [1440, 390]) {
  test(`the large modal fits at ${width}px, traps focus and scrolls without moving the article`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(article);
    const link = page.locator(`.expressive-code a[href="${sourceHref}"]`);
    await link.focus();
    await link.press("Enter");
    const dialog = page.locator(dialogSelector);
    await expect(dialog).toHaveAttribute("data-state", "ready", { timeout: 15000 });
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(901);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    const articleY = await page.evaluate(() => window.scrollY);
    const body = dialog.locator("[data-github-preview-body]");
    const before = await body.evaluate((element) => element.scrollTop);
    await body.hover();
    await page.mouse.wheel(0, 350);
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(before);
    expect(await page.evaluate(() => window.scrollY)).toBe(articleY);
    await dialog.locator("[data-github-preview-selection]").click();
    await expect(dialog.locator('[data-source-line="307"]')).toBeInViewport();
    await dialog.locator("[data-github-preview-close]").click();
    await expect(link).toBeFocused();
  });
}

test("returning through Astro navigation restores one functional source viewer", async ({ page }) => {
  await page.goto(article);
  await page.locator(`.expressive-code a[href="${sourceHref}"]`).click();
  await expect(page.locator(dialogSelector)).toHaveAttribute("data-state", "ready", { timeout: 15000 });
  await page.keyboard.press("Escape");
  await page.locator('.post-head a[href="/blog/tags/smart-mix"]').click();
  await page.locator(`[data-tag-posts] h2 a[href="${article}"]`).click();
  await expect(page.locator(dialogSelector)).toHaveCount(1);
  await page.locator(`.expressive-code a[href="${sourceHref}"]`).click();
  await expect(page.locator(dialogSelector)).toHaveAttribute("data-state", "ready", { timeout: 15000 });
  await page.keyboard.press("Escape");
  await expect(page.locator(dialogSelector)).toBeHidden();
});
