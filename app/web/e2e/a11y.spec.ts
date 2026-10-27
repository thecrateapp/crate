import { expect, test, type Page } from "@playwright/test";

const PAGES = [
  "/",
  "/listen",
  "/admin",
  "/architecture",
  "/developers",
  "/install",
  "/why",
];

async function tabTo(page: Page, selector: string) {
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    if (
      await page.evaluate((s) => document.activeElement?.matches(s), selector)
    )
      return;
  }
  throw new Error(`${selector} never received focus`);
}

async function focusOutline(page: Page) {
  return page.evaluate(() => {
    const style = getComputedStyle(document.activeElement as Element);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
}

test("the skip link is the first stop and moves to the main content", async ({
  page,
}) => {
  await page.goto("/listen");
  await page.keyboard.press("Tab");

  const skip = page.locator("a.skip");
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test("nav links and the install button show a visible focus ring", async ({
  page,
}) => {
  await page.goto("/");

  await tabTo(page, ".nav .links a");
  expect(await focusOutline(page)).toEqual({ style: "solid", width: "2px" });

  await tabTo(page, ".hero-copy [data-copy]");
  expect(await focusOutline(page)).toEqual({ style: "solid", width: "2px" });
});

test("muted text tokens meet WCAG AA contrast on the page background", async ({
  page,
}) => {
  await page.goto("/");
  const ratios = await page.evaluate(() => {
    const parse = (value: string) =>
      value.match(/[\d.]+/g)!.map(Number) as [number, number, number, number?];
    const channel = (c: number) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const luminance = ([r, g, b]: number[]) =>
      0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    const root = getComputedStyle(document.documentElement);
    const bg = root
      .getPropertyValue("--bg")
      .trim()
      .slice(1)
      .match(/../g)!
      .map((hex) => parseInt(hex, 16));
    return ["--fg-2", "--fg-3"].map((token) => {
      const [r, g, b, a = 1] = parse(root.getPropertyValue(token));
      const blended = [r, g, b].map((c, i) => c * a + bg[i] * (1 - a));
      const [hi, lo] = [luminance(blended), luminance(bg)].sort(
        (x, y) => y - x,
      );
      return (hi + 0.05) / (lo + 0.05);
    });
  });

  for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
});

for (const path of PAGES) {
  test(`${path} hides decorative canvases from assistive tech`, async ({
    page,
  }) => {
    await page.goto(path);
    const exposed = await page.evaluate(
      () =>
        [...document.querySelectorAll("canvas")].filter(
          (canvas) => !canvas.closest("[aria-hidden='true']"),
        ).length,
    );
    expect(exposed).toBe(0);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("main#main")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveCount(1);
  });
}

test.describe("touch", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("chapter and footer links have 44px tap targets", async ({ page }) => {
    await page.goto("/listen");
    const misses = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".toc a, .footer a")].flatMap(
        (link) => {
          link.scrollIntoView({ block: "center" });
          const box = link.getBoundingClientRect();
          const x = box.left + box.width / 2;
          const y = box.top + box.height / 2;
          return [y - 21, y + 21]
            .filter(
              (probe) => !link.contains(document.elementFromPoint(x, probe)),
            )
            .map(() => link.textContent?.trim());
        },
      ),
    );
    expect(misses).toEqual([]);
  });
});
