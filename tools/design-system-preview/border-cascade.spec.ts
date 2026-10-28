import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

for (const app of ["ui", "listen"]) {
  test(`${app} CSS preserves explicit border colours over the default`, async ({
    page,
  }) => {
    const css = resolve(process.cwd(), `app/${app}/src/index.css`);
    await page.route(`**/border-cascade-${app}.html`, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html class="dark"><head><link rel="stylesheet" href="/@fs${css}?direct"></head><body>
        <div id="accent" class="border border-accent-action">Accent</div>
        <div id="quiet" class="border border-border-quiet">Quiet</div>
        <div id="transparent" class="border border-transparent">Transparent</div>
        <div id="default" class="border">Default</div>
        <div id="reference-accent" style="border:1px solid var(--accent-action)"></div>
        <div id="reference-quiet" style="border:1px solid var(--border-quiet)"></div>
        <div id="reference-transparent" style="border:1px solid transparent"></div>
        <div id="reference-default" style="border:1px solid var(--color-border)"></div>
      </body></html>`,
      }),
    );
    await page.goto(`/border-cascade-${app}.html`);
    for (const id of ["accent", "quiet", "transparent", "default"]) {
      const expected = await page
        .locator(`#reference-${id}`)
        .evaluate((el) => getComputedStyle(el).borderTopColor);
      await expect
        .soft(page.locator(`#${id}`), `${app} ${id} border`)
        .toHaveCSS("border-top-color", expected, { timeout: 1000 });
    }
  });
}
