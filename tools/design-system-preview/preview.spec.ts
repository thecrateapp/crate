import { expect, test, type Locator, type Page } from "@playwright/test";

async function settleFocusRing(target: Locator) {
  await target.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations()
        .filter((animation) => animation.id === "crate-focus-ring")
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
}

async function expectAdminReferenceGallery(page: Page) {
  await page.goto("/#base-admin");
  const gallery = page.locator("#base-admin");
  await expect(
    gallery.getByRole("heading", {
      level: 2,
      name: "La base de Admin, antes de cambiarla.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    gallery.getByText("Referencias de Linux CI. Capturas base verificadas.", {
      exact: true,
    }),
  ).toBeVisible();

  const figures = gallery.locator("figure");
  await expect(figures).toHaveCount(7);
  await expect(gallery.locator("img")).toHaveCount(7);
  for (const label of [
    "Dashboard",
    "Tasks",
    "Library Health",
    "Genres",
    "Album",
    "Settings",
    "System Health",
  ]) {
    const figure = figures.filter({
      has: page.locator("figcaption", { hasText: label }),
    });
    await expect(figure).toHaveCount(1);
    await expect(figure.locator("figcaption")).toHaveText(label);

    const image = figure.getByRole("img", {
      name: `Admin actual: ${label}`,
      exact: true,
    });
    const placeholder = figure.getByText("Vista local pendiente de generar", {
      exact: true,
    });
    if ((await image.count()) > 0) {
      await expect(figure.locator("img")).toHaveCount(1);
      await expect(placeholder).toHaveCount(0);
      await image.scrollIntoViewIfNeeded();
      await expect(image).toBeVisible();
      await expect
        .poll(() =>
          image.evaluate((element) => {
            const preview = element as HTMLImageElement;
            return (
              preview.complete &&
              preview.naturalWidth > 0 &&
              preview.naturalHeight > 0
            );
          }),
        )
        .toBe(true);
      const source = await image.evaluate(
        (element) => (element as HTMLImageElement).currentSrc,
      );
      expect(new URL(source).pathname).toMatch(/\.png$/i);
      const targets = await figure
        .getByRole("link")
        .evaluateAll((links) =>
          links.map((link) => (link as HTMLAnchorElement).href),
        );
      expect(targets).toContain(source);
    } else {
      await expect(figure.locator("img")).toHaveCount(0);
      await placeholder.scrollIntoViewIfNeeded();
      await expect(placeholder).toBeVisible();
      await expect(figure.locator('a[href*=".png"]')).toHaveCount(0);
    }
  }

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
}

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

test("shows the seven Admin reference scenes with local previews or explicit pending states", async ({
  page,
}) => {
  await expectAdminReferenceGallery(page);
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

test("keeps GenrePill percentages and opens the selected genre", async ({
  page,
}) => {
  await page.goto("/#genre-pill");
  const profile = page.getByRole("group", {
    name: "Perfil de género del artista",
  });
  await expect(
    profile.getByRole("button", { name: "shoegaze 61%", exact: true }),
  ).toBeVisible();
  await profile
    .getByRole("button", { name: "dream pop 27%", exact: true })
    .click();
  await expect(page.locator(".genre-selection")).toContainText("Dream pop");
  await expect(profile.getByRole("button").first()).not.toHaveAttribute(
    "aria-pressed",
  );
});

test("removes a genre independently without renormalising the remaining percentages", async ({
  page,
}) => {
  await page.goto("/#genre-pill");
  const editor = page.getByRole("group", { name: "Etiquetas editables" });
  await editor
    .getByRole("button", { name: "Quitar shoegaze", exact: true })
    .click();
  await expect(editor.getByText("61%")).toHaveCount(0);
  await expect(editor.getByText("27%")).toBeVisible();
  await expect(editor.getByText("12%")).toBeVisible();
  await page.getByRole("button", { name: "Restaurar etiquetas" }).click();
  await expect(editor.getByText("61%")).toBeVisible();
});

test("keeps optional zero and full percentages distinct from a missing value", async ({
  page,
}) => {
  const optional = page.getByRole("group", { name: "Porcentajes opcionales" });
  await expect(optional.getByText("post-rock", { exact: true })).toBeVisible();
  await expect(optional.getByText("0%", { exact: true })).toBeVisible();
  await expect(optional.getByText("100%", { exact: true })).toBeVisible();
  const style = await page
    .locator(".genre-context .genre-pill")
    .first()
    .evaluate((element) => ({
      font: getComputedStyle(element).fontFamily,
      size: getComputedStyle(element).fontSize,
      minHeight: getComputedStyle(element).minHeight,
    }));
  expect(style.font).toContain("JetBrains Mono");
  expect(style.size).toBe("11px");
  expect(style.minHeight).toBe("32px");
});

test("uses the global outline for standard controls, CTAs and edge-to-edge rows", async ({
  page,
}) => {
  await page.goto("/#foco");
  await page.keyboard.press("Tab");
  for (const [name, offset] of [
    ["Añadir a la cola", "0px"],
    ["Reproducir ahora", "0px"],
    ["01 Abrir canción 4:11", "-2px"],
  ]) {
    const control = page.getByRole("button", { name, exact: true });
    const before = await control.boundingBox();
    await control.focus();
    await settleFocusRing(control);
    await expect(control).toHaveCSS("outline-color", "rgb(6, 182, 212)");
    const style = await control.evaluate((element) => ({
      visible: element.matches(":focus-visible"),
      width: getComputedStyle(element).outlineWidth,
      offset: getComputedStyle(element).outlineOffset,
      style: getComputedStyle(element).outlineStyle,
      color: getComputedStyle(element).outlineColor,
    }));
    expect(style).toEqual({
      visible: true,
      width: "2px",
      offset,
      style: "solid",
      color: "rgb(6, 182, 212)",
    });
    expect((await control.boundingBox())?.width).toBe(before?.width);
    expect((await control.boundingBox())?.height).toBe(before?.height);
  }
});

test("keeps the real Select menu's keyboard outline inside each option", async ({
  page,
}) => {
  await page.goto("/#foco");
  await page.keyboard.press("Tab");
  const trigger = page.getByRole("combobox", { name: "Género de ejemplo" });
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  const option = page.getByRole("option", { name: "Ambient", exact: true });
  await expect(option).toBeVisible();
  await option.focus();
  await settleFocusRing(option);
  await expect(option).toHaveCSS("outline-offset", "-2px");
  await expect(option).toHaveCSS("outline-width", "2px");
  await page.keyboard.press("Escape");
});

test("keeps pointer clicks separate from keyboard focus and uses Crate text selection", async ({
  page,
}) => {
  await page.goto("/#foco");
  const control = page.getByRole("button", {
    name: "Añadir a la cola",
    exact: true,
  });
  await control.click();
  expect(
    await control.evaluate((element) => element.matches(":focus-visible")),
  ).toBe(false);
  const colours = await page
    .locator(".selection-example")
    .evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--accent-action)";
      probe.style.backgroundColor = "var(--surface-canvas)";
      document.body.append(probe);
      const expectedBackground = getComputedStyle(probe).color;
      const expectedForeground = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const selection = getComputedStyle(element, "::selection");
      return {
        background: selection.backgroundColor,
        foreground: selection.color,
        expectedBackground,
        expectedForeground,
      };
    });
  expect(colours.background).toBe(colours.expectedBackground);
  expect(colours.foreground).toBe(colours.expectedForeground);
});

test.describe("touch layout", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("keeps the Admin reference gallery usable without horizontal overflow", async ({
    page,
  }) => {
    await expectAdminReferenceGallery(page);
  });

  test("keeps 44px interactive targets without horizontal overflow", async ({
    page,
  }) => {
    const sizes = await page
      .locator(
        "#filas-y-chips button, #filas-y-chips .rows-preview a, #genre-pill button.genre-pill, #genre-pill .genre-pill button",
      )
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
