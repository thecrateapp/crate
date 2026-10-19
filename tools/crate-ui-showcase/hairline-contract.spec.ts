import { expect, test } from "@playwright/test";
test("row typography owns the approved 12/18 Poppins role in every context", async ({
  page,
}) => {
  await page.goto(
    "/iframe.html?id=components-hairlinerow--typography-context&viewMode=story",
  );
  for (const title of [
    "Canonical row typography",
    "Canonical button typography",
  ]) {
    const text = page.getByText(title, { exact: true });
    await expect(text).toHaveCSS("font-size", "12px");
    await expect(text).toHaveCSS("line-height", "18px");
    await expect(text).toHaveCSS("font-weight", "400");
    await expect(text).toHaveCSS("font-family", /Poppins/);
  }
});
for (const width of [390, 1200]) {
  for (const coarse of [false, true]) {
    test.describe(`${width}px ${coarse ? "coarse" : "fine"}`, () => {
      test.use({ viewport: { width, height: 900 }, hasTouch: coarse });
      test("HairlineRow owns its inset and alignment in every composition", async ({
        page,
      }) => {
        for (const story of [
          "base",
          "active-without-index",
          "multiline",
          "link",
        ]) {
          await page.goto(
            `/iframe.html?id=components-hairlinerow--${story}&viewMode=story`,
          );
          const rows = page.locator('[data-slot="hairline-row"]');
          await expect(rows.first()).toBeVisible();
          for (const row of await rows.all()) {
            const native = row.locator(":scope > button, :scope > a");
            const carrier = (await native.count()) ? native : row;
            await expect(carrier).toHaveCSS("padding-left", "12px");
            await expect(carrier).toHaveCSS("padding-right", "12px");
            await expect(carrier).toHaveCSS("text-align", "left");
            await expect(carrier).toHaveCSS("font-size", "12px");
            await expect(carrier).toHaveCSS("line-height", "18px");
            await expect(carrier).toHaveCSS("font-weight", "400");
            await expect(carrier).toHaveCSS("font-family", /Poppins/);
            await expect(carrier).toHaveCSS("padding-top", "10px");
            await expect(carrier).toHaveCSS("padding-bottom", "10px");
            await expect(carrier).toHaveCSS(
              "min-height",
              coarse ? "44px" : "32px",
            );
            const geometry = await carrier.evaluate((e) => {
              const rect = e.getBoundingClientRect();
              const spans = Array.from(e.children).filter(
                (c) => !c.hasAttribute("aria-hidden"),
              );
              return {
                left: rect.left,
                right: rect.right,
                start: spans[0]!.getBoundingClientRect().left,
                end: spans.at(-1)!.getBoundingClientRect().right,
              };
            });
            expect(geometry.start - geometry.left).toBeCloseTo(12, 1);
            expect(geometry.end).toBeLessThanOrEqual(geometry.right - 11.5);
            const before = await row.evaluate((e) => ({
              bg: getComputedStyle(e).backgroundColor,
              image: getComputedStyle(e).backgroundImage,
            }));
            await carrier.hover();
            expect(
              await row.evaluate((e) => ({
                bg: getComputedStyle(e).backgroundColor,
                image: getComputedStyle(e).backgroundImage,
              })),
            ).toEqual(before);
          }
        }
      });
    });
  }
}
test("long titles truncate or wrap without overflowing the row", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(
    "/iframe.html?id=components-hairlinerow--long-titles&viewMode=story",
  );
  const rows = page
    .getByRole("list", { name: "Long titles" })
    .getByRole("listitem");
  await expect(rows).toHaveCount(2);
  const metrics = await rows.evaluateAll((elements) =>
    elements.map((row) => {
      const title = Array.from(row.querySelectorAll("span,div")).find((e) =>
        e.textContent?.startsWith("LongUnbrokenTitle"),
      )!;
      return {
        rowWidth: row.clientWidth,
        scrollWidth: row.scrollWidth,
        titleWidth: title.clientWidth,
        titleScroll: title.scrollWidth,
        titleHeight: title.getBoundingClientRect().height,
        line: parseFloat(getComputedStyle(title).lineHeight),
      };
    }),
  );
  expect(metrics[0]!.titleScroll).toBeGreaterThan(metrics[0]!.titleWidth);
  expect(metrics[0]!.scrollWidth).toBeLessThanOrEqual(metrics[0]!.rowWidth);
  expect(metrics[1]!.scrollWidth).toBeLessThanOrEqual(metrics[1]!.rowWidth);
  expect(metrics[1]!.titleHeight).toBeGreaterThan(metrics[1]!.line * 2);
});
