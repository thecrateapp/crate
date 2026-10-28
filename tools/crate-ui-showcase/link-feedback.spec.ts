import { expect, test } from "@playwright/test";
for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`shared links without beams (${reducedMotion})`, async ({ browser }) => {
    const context = await browser.newContext({
      reducedMotion,
      viewport: { width: 1200, height: 900 },
    });
    const page = await context.newPage();
    await page.goto("/iframe.html?id=system-foundations--links&viewMode=story");
    await expect(
      page.getByRole("heading", { name: "Link feedback" }),
    ).toBeVisible({ timeout: 30000 });
    for (const name of [
      "Metadata link",
      "Accent link",
      "Inset focus link inside clipped text",
    ]) {
      const link = page.getByRole("link", { name, exact: true });
      const base = await link.evaluate((el) => getComputedStyle(el).color);
      await link.hover();
      await expect(link).not.toHaveCSS("color", base);
      const pseudo = await link.evaluate((el) =>
        ["::before", "::after"].map((part) => {
          const style = getComputedStyle(el, part);
          return { content: style.content, animation: style.animationName };
        }),
      );
      for (const style of pseudo) {
        expect(style.content).toMatch(/^(none|normal)$/);
        expect(style.animation).toBe("none");
      }
      await expect(link).toHaveCSS("clip-path", "none");
    }
    await page
      .getByRole("link", { name: "Metadata link", exact: true })
      .press("Tab");
    const focused = page.getByRole("link", {
      name: "Accent link",
      exact: true,
    });
    await expect(focused).toBeFocused();
    await expect(focused).toHaveCSS("outline-style", "solid");
    await expect(focused).toHaveCSS("outline-width", "2px");
    await focused.press("Tab");
    const inset = page.getByRole("link", {
      name: "Inset focus link inside clipped text",
      exact: true,
    });
    await expect(inset).toBeFocused();
    await expect(inset).toHaveCSS("outline-offset", "-2px");
    await expect(inset).toHaveCSS("text-decoration-line", "underline");
    await context.close();
  });
}
