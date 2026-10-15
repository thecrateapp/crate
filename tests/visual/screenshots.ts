import { expect, type Page, type TestInfo } from "@playwright/test";

export async function capturePage(
  page: Page,
  info: TestInfo,
  name: string,
  { fullPage = false }: { fullPage?: boolean } = {},
) {
  await page.evaluate(() => document.fonts.ready);
  if (process.env.CRATE_VISUAL_SMOKE === "1") {
    await page.screenshot({
      path: info.outputPath(`${name}.png`),
      animations: "disabled",
      caret: "hide",
      fullPage,
    });
    return;
  }
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage });
}
