import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/#filas-y-chips");
  await page.evaluate(() => document.fonts.ready);
});

test("preserves the approved specimens alongside the new checkpoint", async ({
  page,
}) => {
  await expect(page.locator("article.specimen")).toHaveCount(3);
  await expect(page.locator(".next-specimen")).toHaveCount(2);
  await expect(page.locator(".rows-preview li")).toHaveCount(4);
});

test("selects a whole row through its trailing slot", async ({ page }) => {
  const row = page.locator(".rows-preview li").nth(1);
  await row.locator("button").getByText("6:24").click();
  await expect(row).toHaveAttribute("data-active", "true");
  await expect(row.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#detalle-cancion")).toContainText("Daydreaming");
});

test("toggles filters and resets them with an ordinary action button", async ({
  page,
}) => {
  const rock = page.getByRole("button", { name: "Rock", exact: true });
  await rock.click();
  await expect(rock).toHaveAttribute("aria-pressed", "true");
  const reset = page.getByRole("button", { name: "Limpiar filtros" });
  await expect(reset).not.toHaveAttribute("aria-pressed");
  await reset.click();
  await expect(rock).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByText("Todos los géneros", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Próximamente" }),
  ).toBeDisabled();
});

test("renders the chip typography and presses through the scale longhand", async ({
  page,
}) => {
  const pill = page.getByRole("button", { name: "Jazz", exact: true });
  const style = await pill.evaluate((element) => {
    const value = getComputedStyle(element);
    return {
      font: value.fontFamily,
      size: value.fontSize,
      minHeight: value.minHeight,
    };
  });
  expect(style.font).toContain("JetBrains Mono");
  expect(style.size).toBe("11px");
  expect(style.minHeight).toBe("32px");
  await pill.hover();
  await page.mouse.down();
  try {
    await expect
      .poll(() => pill.evaluate((element) => getComputedStyle(element).scale))
      .toBe("0.95");
  } finally {
    await page.mouse.up();
  }
});

for (const source of ["crate", "system"] as const) {
  test(`disables pressed scaling under ${source} reduced motion`, async ({
    page,
  }) => {
    if (source === "system") {
      await page.emulateMedia({ reducedMotion: "reduce" });
    } else {
      await page.evaluate(() => {
        document.documentElement.dataset.crateMotion = "reduced";
      });
    }
    const pill = page.getByRole("button", { name: "Jazz", exact: true });
    await pill.hover();
    await page.mouse.down();
    try {
      expect(await pill.evaluate((element) => element.matches(":active"))).toBe(
        true,
      );
      expect(
        await pill.evaluate((element) => getComputedStyle(element).scale),
      ).toBe("1");
      expect(
        await pill.evaluate(
          (element) => getComputedStyle(element).transitionProperty,
        ),
      ).toBe("none");
      expect(
        await page
          .locator(".crate-hairline-active-bar")
          .first()
          .evaluate((element) => getComputedStyle(element).transitionProperty),
      ).toBe("none");
    } finally {
      await page.mouse.up();
    }
  });
}

test.describe("touch layout", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("keeps 44px interactive targets without horizontal overflow", async ({
    page,
  }) => {
    const sizes = await page
      .locator("#filas-y-chips button, #filas-y-chips .rows-preview a")
      .evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().height),
      );
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
  });
});
