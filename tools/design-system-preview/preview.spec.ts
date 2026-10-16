import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

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

async function expectAdminContrastGallery(page: Page) {
  await page.goto("/#contraste-admin");
  const gallery = page.locator("#contraste-admin");
  await expect(
    gallery.getByRole("heading", {
      level: 2,
      name: "Tarjetas que se distinguen.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    gallery.getByText(
      "Comparación local. Capturas de Linux del cambio verificadas.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    gallery.getByText(
      "Ajuste provisional de contraste. El diseño final de Audio Profile es TrackReadout.",
      { exact: true },
    ),
  ).toBeVisible();

  const target = gallery.locator("aside#audio-profile-objetivo");
  await expect(target).toHaveCount(1);
  await expect(gallery.locator("article #audio-profile-objetivo")).toHaveCount(
    0,
  );
  await expect(
    target.getByRole("heading", {
      level: 3,
      name: "Audio Profile · diseño objetivo",
      exact: true,
    }),
  ).toBeVisible();
  await expect(target.locator("img")).toHaveCount(1);
  const reference = target.getByRole("img", {
    name: "Referencia visual de TrackReadout del site: cifras, cinco barras y vector Bliss, sin iconos",
    exact: true,
  });
  await reference.scrollIntoViewIfNeeded();
  await expect(reference).toBeVisible();
  await expect
    .poll(() =>
      reference.evaluate((element) => {
        const image = element as HTMLImageElement;
        return (
          image.complete && image.naturalWidth > 0 && image.naturalHeight > 0
        );
      }),
    )
    .toBe(true);
  const source = await reference.evaluate(
    (element) => (element as HTMLImageElement).currentSrc,
  );
  const fullImageLink = reference.locator("xpath=ancestor::a[1]");
  await expect(fullImageLink).toHaveCount(1);
  expect(
    await fullImageLink.evaluate(
      (element) => (element as HTMLAnchorElement).href,
    ),
  ).toBe(source);

  const articles = gallery.locator("article");
  await expect(articles).toHaveCount(2);
  await expect(gallery.locator("figure")).toHaveCount(4);
  for (const title of ["Audio Profile", "Recorte de imagen"]) {
    const article = articles.filter({
      has: page.getByRole("heading", { level: 3, name: title, exact: true }),
    });
    await expect(article).toHaveCount(1);
    await expect(article.locator("figure")).toHaveCount(2);
    for (const [caption, alt] of [
      ["Antes", `${title}: antes`],
      ["Con borde", `${title}: con borde`],
    ]) {
      const figure = article.locator("figure").filter({
        has: page.locator("figcaption", { hasText: caption }),
      });
      await expect(figure).toHaveCount(1);
      await expect(figure.locator("figcaption")).toHaveText(caption);
      const image = figure.getByRole("img", { name: alt, exact: true });
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

test("shows both Admin contrast comparisons with local images or explicit pending states", async ({
  page,
}) => {
  await expectAdminContrastGallery(page);
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

  test("keeps both Admin contrast comparisons usable without horizontal overflow", async ({
    page,
  }) => {
    await expectAdminContrastGallery(page);
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

async function expectInstrumentPanelCheckpoint(page: Page, info: TestInfo) {
  await page.goto("/#paneles");
  await page.evaluate(() => document.fonts.ready);
  const checkpoint = page.locator("#paneles");
  await expect(
    checkpoint.getByRole("heading", {
      level: 2,
      name: "Una estructura común para los paneles.",
      exact: true,
    }),
  ).toBeVisible();

  const resources = checkpoint.getByRole("figure", {
    name: "280 GB de música y 12 pistas pendientes.",
    exact: true,
  });
  await expect(
    resources.getByRole("heading", {
      level: 3,
      name: "Resources",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    resources.getByText("Actualizado hace 12 s", { exact: true }),
  ).toBeVisible();
  await expect(resources).toHaveCSS("border-top-width", "1px");
  await expect(resources).toHaveCSS("border-top-style", "solid");
  await expect(resources).toHaveCSS("container-type", "inline-size");
  await expect(resources).toHaveCSS("border-top-left-radius", "0px");
  await expect(resources).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  const status = resources.locator('[aria-live="polite"]');
  await expect(status).toHaveCount(1);
  await expect(status).toHaveText("En vivo");
  await expect(status.getByRole("button")).toHaveCount(0);
  for (const metric of ["280", "12"]) {
    await expect(resources.getByText(metric, { exact: true })).toBeVisible();
    await expect(status.getByText(metric, { exact: true })).toHaveCount(0);
  }
  const pause = checkpoint.getByRole("button", {
    name: "Pausar panel",
    exact: true,
  });
  await expect(
    status.getByRole("button", { name: "Pausar panel", exact: true }),
  ).toHaveCount(0);
  await pause.click();
  await expect(status).toHaveText("En pausa");
  const resume = checkpoint.getByRole("button", {
    name: "Reanudar panel",
    exact: true,
  });
  await expect(resume).toBeVisible();
  for (const metric of ["280", "12"]) {
    await expect(resources.getByText(metric, { exact: true })).toBeVisible();
  }
  await resume.click();
  await expect(status).toHaveText("En vivo");

  const playback = checkpoint.getByRole("region", {
    name: "Reproducción de ejemplo",
    exact: true,
  });
  await expect(
    playback.getByRole("heading", {
      level: 2,
      name: "Reproducción de ejemplo",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    playback.getByText("Preferencias del reproductor.", { exact: true }),
  ).toBeVisible();
  const headingOffsets = await Promise.all(
    [resources, playback].map((panel) =>
      panel.evaluate((element) => {
        const heading = element.querySelector("h2, h3");
        if (!heading) throw new Error("Expected an instrument panel heading");
        return (
          heading.getBoundingClientRect().top -
          element.getBoundingClientRect().top -
          parseFloat(getComputedStyle(element).borderTopWidth)
        );
      }),
    ),
  );
  expect(Math.abs(headingOffsets[0]! - headingOffsets[1]!)).toBeLessThanOrEqual(
    0.5,
  );
  await expect(playback).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  for (const side of ["right", "bottom", "left"]) {
    await expect(playback).toHaveCSS(`border-${side}-width`, "0px");
  }
  const normalization = playback.getByRole("switch", {
    name: "Normalizar volumen",
    exact: true,
  });
  const initialState = await normalization.getAttribute("aria-checked");
  expect(["true", "false"]).toContain(initialState);
  await normalization.click();
  await expect(normalization).toHaveAttribute(
    "aria-checked",
    initialState === "true" ? "false" : "true",
  );

  const unruled = checkpoint.getByRole("region", {
    name: "Panel sin regla",
    exact: true,
  });
  await expect(
    unruled.getByRole("heading", {
      level: 3,
      name: "Panel sin regla",
      exact: true,
    }),
  ).toBeVisible();
  await expect(unruled).toHaveCSS("border-top-width", "0px");
  await expect(unruled).not.toHaveClass(/(?:^|\s)border-t(?:\s|$)/);
  expect(
    await checkpoint.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));

  const screenshot = info.outputPath("checkpoint-1g.png");
  await checkpoint.screenshot({ path: screenshot, animations: "disabled" });
  await info.attach("Checkpoint 1G", {
    path: screenshot,
    contentType: "image/png",
  });
}

test("keeps the instrument panel checkpoint accessible and interactive", async ({
  page,
}, info) => {
  await expectInstrumentPanelCheckpoint(page, info);
});

test.describe("instrument panel touch layout", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("keeps the instrument panels usable at 390px without horizontal overflow", async ({
    page,
  }, info) => {
    await expectInstrumentPanelCheckpoint(page, info);
  });
});

async function expectMeterCheckpoint(page: Page, info: TestInfo) {
  await page.goto("/#meters");
  await page.evaluate(() => document.fonts.ready);
  const checkpoint = page.locator("#meters");
  await expect(
    checkpoint.getByRole("heading", {
      level: 2,
      name: "Medir capacidad sin ocultar los límites.",
      exact: true,
    }),
  ).toBeVisible();

  const offline = checkpoint.getByRole("meter", {
    name: "Pistas offline",
    exact: true,
  });
  await expect(offline).toHaveAttribute("aria-valuemin", "0");
  await expect(offline).toHaveAttribute("aria-valuemax", "48");
  await expect(offline).toHaveAttribute("aria-valuenow", "36");
  await expect(offline).toHaveAttribute("aria-valuetext", "36/48");
  await expect(offline.getByText("36/48", { exact: true })).toBeVisible();
  const offlineFill = offline.locator(".crate-meter-fill");
  expect(
    await offlineFill.evaluate((element) =>
      parseFloat(getComputedStyle(element).getPropertyValue("--v")),
    ),
  ).toBeCloseTo(0.75);
  expect(
    await offlineFill.evaluate(
      (element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a,
    ),
  ).toBeCloseTo(0.75);

  const transcoding = checkpoint.getByRole("meter", {
    name: /^Transcodificación(?:\s|$)/,
  });
  await expect(transcoding).toHaveAttribute("aria-valuemax", "4");
  await expect(transcoding).toHaveAttribute("aria-valuenow", "2");
  await expect(transcoding).toHaveAttribute("aria-valuetext", "2/4");
  const limit = transcoding.locator(".crate-meter-limit");
  await expect(limit).toHaveAttribute("aria-hidden", "true");
  const limitPosition = await transcoding.evaluate((element) => {
    const track = element.querySelector(".crate-meter-track");
    const tick = element.querySelector(".crate-meter-limit");
    if (!track || !tick) throw new Error("Expected a meter track and limit");
    const trackBox = track.getBoundingClientRect();
    const tickBox = tick.getBoundingClientRect();
    return {
      actual: tickBox.left + tickBox.width / 2,
      expected: trackBox.left + trackBox.width * 0.75,
    };
  });
  expect(
    Math.abs(limitPosition.actual - limitPosition.expected),
  ).toBeLessThanOrEqual(1);

  await checkpoint
    .getByRole("button", { name: "Superar límite", exact: true })
    .click();
  await expect(transcoding).toHaveAccessibleName(/over · max 4/);
  await expect(transcoding).toHaveAttribute("aria-valuenow", "4");
  await expect(transcoding).toHaveAttribute("aria-valuetext", "5/4");
  const overValue = transcoding.getByText("5/4", { exact: true });
  await expect(overValue).toBeVisible();
  const warning = await transcoding.evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--state-warning)";
    element.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect(overValue).toHaveCSS("color", warning);
  await expect(transcoding.locator(".crate-meter-fill")).toHaveCSS(
    "background-color",
    warning,
  );
  expect(
    await transcoding
      .locator(".crate-meter-fill")
      .evaluate(
        (element) =>
          new DOMMatrixReadOnly(getComputedStyle(element).transform).a,
      ),
  ).toBeCloseTo(1);
  await checkpoint
    .getByRole("button", { name: "Restablecer capacidad", exact: true })
    .click();
  await expect(transcoding).toHaveAccessibleName("Transcodificación");
  await expect(transcoding).toHaveAttribute("aria-valuenow", "2");
  await expect(transcoding).toHaveAttribute("aria-valuetext", "2/4");

  const missing = checkpoint.getByRole("group", {
    name: "Sin datos",
    exact: true,
  });
  await expect(missing.getByText("n/a", { exact: true })).toBeVisible();
  await expect(missing).toHaveAccessibleDescription("n/a");
  for (const attribute of ["aria-valuemin", "aria-valuemax", "aria-valuenow"]) {
    await expect(missing).not.toHaveAttribute(attribute);
  }
  await expect(missing.locator(".crate-meter-fill")).not.toBeVisible();

  for (const thickness of [1, 2, 3, 4]) {
    await expect(
      checkpoint
        .getByRole("meter", { name: `Grosor ${thickness}`, exact: true })
        .locator(".crate-meter-track"),
    ).toHaveCSS("height", `${thickness}px`);
  }
  expect(
    await checkpoint.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));

  const screenshot = info.outputPath("checkpoint-1h.png");
  await checkpoint.screenshot({ path: screenshot, animations: "disabled" });
  await info.attach("Checkpoint 1H", {
    path: screenshot,
    contentType: "image/png",
  });
}

test("keeps the meter checkpoint accessible and interactive", async ({
  page,
}, info) => {
  await expectMeterCheckpoint(page, info);
});

test.describe("meter touch layout", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("keeps the meters usable at 390px without horizontal overflow", async ({
    page,
  }, info) => {
    await expectMeterCheckpoint(page, info);
  });
});

test("keeps meter tracks, fills and limits visible in forced colors", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/#meters");
  const checkpoint = page.locator("#meters");
  const offline = checkpoint.getByRole("meter", {
    name: "Pistas offline",
    exact: true,
  });
  await expect(offline).toBeVisible();
  const systemColors = await offline.evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.forcedColorAdjust = "none";
    probe.style.color = "CanvasText";
    probe.style.backgroundColor = "Highlight";
    element.append(probe);
    const style = getComputedStyle(probe);
    const colors = {
      canvasText: style.color,
      highlight: style.backgroundColor,
    };
    probe.remove();
    return colors;
  });
  const track = offline.locator(".crate-meter-track");
  await expect(track).toHaveCSS("border-top-color", systemColors.canvasText);
  expect(
    await track.evaluate((element) =>
      parseFloat(getComputedStyle(element).borderTopWidth),
    ),
  ).toBeGreaterThan(0);
  await expect(offline.locator(".crate-meter-fill")).toHaveCSS(
    "background-color",
    systemColors.highlight,
  );
  await expect(
    checkpoint
      .getByRole("meter", { name: "Transcodificación", exact: true })
      .locator(".crate-meter-limit"),
  ).toHaveCSS("background-color", systemColors.canvasText);
});

async function expectReadoutCheckpoint(page: Page, info: TestInfo) {
  await page.goto("/#readout");
  await page.evaluate(() => document.fonts.ready);
  const checkpoint = page.locator("#readout");
  await expect(
    checkpoint.getByRole("heading", {
      level: 2,
      name: "Una lectura estable, un anuncio al confirmar.",
      exact: true,
    }),
  ).toBeVisible();

  const example = checkpoint.locator('[data-readout-example="interactive"]');
  const visible = example.locator(".crate-readout");
  const announcement = example.getByRole("status");
  await expect(visible).toHaveCount(1);
  await expect(visible).toHaveAttribute("aria-hidden", "true");
  await expect(visible).toHaveText("Genre · Shoegaze");
  await expect(visible).toHaveCSS("font-size", "11.5px");
  await expect(announcement).toHaveCount(1);
  await expect(announcement).toHaveAttribute("aria-live", "polite");
  await expect(announcement).toHaveAttribute("aria-atomic", "true");
  await expect(announcement).toHaveText("Genre · Shoegaze");

  const initialGeometry = await visible.evaluate((element) => {
    const style = getComputedStyle(element);
    const context = document.createElement("canvas").getContext("2d");
    if (!context) throw new Error("Expected a 2D font measurement context");
    context.font = `${style.fontSize} ${style.fontFamily}`;
    return {
      width: element.getBoundingClientRect().width,
      expectedReservedWidth: context.measureText("0").width * 32,
      minHeight: parseFloat(style.minHeight),
      fontFamily: style.fontFamily,
    };
  });
  expect(initialGeometry.fontFamily).toMatch(/mono/i);
  expect(initialGeometry.minHeight).toBeGreaterThanOrEqual(16);
  expect(
    Math.abs(initialGeometry.width - initialGeometry.expectedReservedWidth),
  ).toBeLessThanOrEqual(1);
  const initialAnnouncementMarkup = await announcement.evaluate(
    (element) => element.outerHTML,
  );

  const preview = checkpoint.getByRole("button", {
    name: "Previsualizar Ambient",
    exact: true,
  });
  await preview.hover();
  await expect(announcement).toHaveText("Genre · Shoegaze");
  await preview.click();
  await expect(visible).toHaveText("Genre · Ambient");
  await expect(announcement).toHaveText("Genre · Shoegaze");
  expect(await announcement.evaluate((element) => element.outerHTML)).toBe(
    initialAnnouncementMarkup,
  );
  expect(
    Math.abs(
      (await visible.evaluate(
        (element) => element.getBoundingClientRect().width,
      )) - initialGeometry.width,
    ),
  ).toBeLessThanOrEqual(0.5);

  await checkpoint
    .getByRole("button", { name: "Confirmar lectura", exact: true })
    .click();
  await expect(visible).toHaveText("Genre · Ambient");
  await expect(announcement).toHaveText("Genre · Ambient");
  await checkpoint
    .getByRole("button", { name: "Restablecer lectura", exact: true })
    .click();
  await expect(visible).toHaveText("Genre · Shoegaze");
  await expect(announcement).toHaveText("Genre · Shoegaze");
  expect(
    Math.abs(
      (await visible.evaluate(
        (element) => element.getBoundingClientRect().width,
      )) - initialGeometry.width,
    ),
  ).toBeLessThanOrEqual(0.5);

  const visualOnly = checkpoint
    .locator(".crate-readout")
    .filter({ hasText: "Solo lectura visual" });
  await expect(visualOnly).toBeVisible();
  await expect(visualOnly).toHaveAttribute("aria-hidden", "true");
  const announcements = checkpoint.getByRole("status");
  await expect(announcements).toHaveCount(2);
  await expect(announcements.nth(1)).toHaveText("");
  await expect(announcements.nth(1)).toHaveAttribute("aria-live", "polite");
  await expect(announcements.nth(1)).toHaveAttribute("aria-atomic", "true");
  expect(
    await checkpoint.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));

  const screenshot = info.outputPath("checkpoint-1i.png");
  await checkpoint.screenshot({ path: screenshot, animations: "disabled" });
  await info.attach("Checkpoint 1I", {
    path: screenshot,
    contentType: "image/png",
  });
}

test("keeps the readout checkpoint stable and announcements committed", async ({
  page,
}, info) => {
  await expectReadoutCheckpoint(page, info);
});

test.describe("readout touch layout", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("keeps the readout usable at 390px without horizontal overflow", async ({
    page,
  }, info) => {
    await expectReadoutCheckpoint(page, info);
  });
});

async function expectHairlineScale(fill: Locator, expected: number) {
  await expect
    .poll(() =>
      fill.evaluate((element) => {
        const transform = getComputedStyle(element).transform;
        return transform === "none" ? 1 : new DOMMatrixReadOnly(transform).a;
      }),
    )
    .toBeCloseTo(expected, 4);
}

async function expectProgressHairlineCheckpoint(page: Page, info: TestInfo) {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/#progreso");
  await page.evaluate(() => document.fonts.ready);
  const checkpoint = page.locator("#progreso");
  await expect(checkpoint).toHaveAccessibleName(
    "Checkpoint 1J, ProgressHairline",
  );
  const determinate = checkpoint.getByRole("progressbar", {
    name: "Importación de biblioteca",
    exact: true,
  });
  const preparing = checkpoint.getByRole("progressbar", {
    name: "Preparación de audio",
    exact: true,
  });
  const fill = determinate.locator(".crate-progress-hairline-fill");
  const preparingFill = preparing.locator(".crate-progress-hairline-fill");
  const expectPercentageAlignment = async (value: string) => {
    const percentage = checkpoint
      .locator(".crate-readout")
      .filter({ hasText: new RegExp(`^${value} %$`) });
    await expect(percentage).toHaveCount(1);
    const textRight = await percentage.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect().right;
    });
    const trackRight = await determinate.evaluate(
      (element) => element.getBoundingClientRect().right,
    );
    expect(Math.abs(textRight - trackRight)).toBeLessThanOrEqual(1);
  };
  await determinate.scrollIntoViewIfNeeded();
  await expect(determinate).toHaveAttribute("aria-valuenow", "50");
  await expect(determinate).toHaveAttribute("aria-valuetext", /12.*24/);
  await expect(determinate).toHaveCSS("height", "2px");
  await expectHairlineScale(fill, 0.5);
  await expectPercentageAlignment("50");
  const advance = checkpoint.getByRole("button", {
    name: "Avanzar 25 %",
    exact: true,
  });
  await advance.click();
  await expect(determinate).toHaveAttribute("aria-valuenow", "75");
  await expectHairlineScale(fill, 0.75);
  await expectPercentageAlignment("75");
  await advance.click();
  await expect(determinate).toHaveAttribute("aria-valuenow", "100");
  await expectHairlineScale(fill, 1);
  await advance.click();
  await expect(determinate).toHaveAttribute("aria-valuenow", "100");
  await checkpoint
    .getByRole("button", { name: "Reiniciar progreso", exact: true })
    .click();
  await expect(determinate).toHaveAttribute("aria-valuenow", "0");
  await expectHairlineScale(fill, 0);

  await preparing.scrollIntoViewIfNeeded();
  await expect(preparing).toHaveCSS("height", "1px");
  await expect(preparing).not.toHaveAttribute("aria-valuenow");
  await expect(preparing).toHaveAttribute("data-animated", "true");
  await expect(preparingFill).toHaveCSS("animation-duration", "2.4s");
  await expect(preparingFill).toHaveCSS(
    "animation-timing-function",
    "cubic-bezier(0.65, 0, 0.35, 1)",
  );
  const geometry = await preparing.evaluate((element) => {
    const inner = element.querySelector(".crate-progress-hairline-fill");
    if (!inner) throw new Error("Progress fill missing");
    return {
      track: element.getBoundingClientRect().width,
      fill: parseFloat(getComputedStyle(inner).width),
    };
  });
  expect(geometry.fill / geometry.track).toBeCloseTo(0.36, 2);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(preparing).not.toHaveAttribute("data-animated", "true");
  await expect(preparingFill).toHaveCSS("animation-name", "none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(preparing).toHaveAttribute("data-animated", "true");
  await page.evaluate(() => {
    document.documentElement.dataset.crateMotion = "reduced";
  });
  await expect(preparing).not.toHaveAttribute("data-animated", "true");
  await expect(preparingFill).toHaveCSS("animation-name", "none");
  await page.evaluate(() => {
    delete document.documentElement.dataset.crateMotion;
  });
  await expect(preparing).toHaveAttribute("data-animated", "true");
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(preparing).not.toHaveAttribute("data-animated", "true");
  await preparing.scrollIntoViewIfNeeded();
  await expect(preparing).toHaveAttribute("data-animated", "true");

  await checkpoint
    .getByRole("button", { name: "Completar preparación", exact: true })
    .click();
  await expect(preparing).toHaveAttribute("aria-valuenow", "100");
  await expect(preparing).not.toHaveAttribute("data-indeterminate", "true");
  await expect(preparingFill).toHaveCSS("animation-name", "none");
  await checkpoint
    .getByRole("button", { name: "Volver a preparar", exact: true })
    .click();
  await expect(preparing).not.toHaveAttribute("aria-valuenow");

  expect(
    await checkpoint.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await advance.click();
  await advance.click();
  const screenshot = info.outputPath("checkpoint-1j.png");
  await checkpoint.screenshot({ path: screenshot, animations: "disabled" });
  await info.attach("Checkpoint 1J", {
    path: screenshot,
    contentType: "image/png",
  });
}

test("keeps the progress hairline checkpoint truthful and motion gated", async ({
  page,
}, info) => {
  await expectProgressHairlineCheckpoint(page, info);
});

test.describe("progress hairline touch layout", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test("keeps progress hairlines usable at 390px without overflow", async ({
    page,
  }, info) => {
    await expectProgressHairlineCheckpoint(page, info);
  });
});

async function expectToasterCheckpoint(page: Page, info: TestInfo) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#toasts");
  await page.evaluate(() => document.fonts.ready);
  const checkpoint = page.locator("#toasts");
  await expect(checkpoint).toHaveAccessibleName("Checkpoint 1K, Toasts");
  await expect(checkpoint.locator("[data-sonner-toast]")).toHaveCount(0);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (/\/api\//.test(request.url()) && request.method() !== "GET") {
      writes.push(`${request.method()} ${request.url()}`);
    }
  });

  await checkpoint
    .getByRole("button", { name: "Mostrar guardado", exact: true })
    .click();
  const toaster = checkpoint.locator(".toast-preview-toaster");
  const toast = toaster.locator(".crate-toast[data-sonner-toast]");
  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveAttribute("data-mounted", "true");
  await expect(toast).toHaveAttribute("data-type", "success");
  await expect(toast).not.toHaveAttribute("data-rich-colors", "true");
  await expect(toast).toHaveAttribute("data-styled", "false");
  await expect(toast.locator(".crate-toast-title")).toHaveText(
    "Guardado en tu colección",
  );
  await expect(toast.locator(".crate-toast-description")).toHaveText(
    "12 canciones añadidas.",
  );
  await expect(toast.locator("[data-icon]")).toHaveCount(0);
  await expect(toast.locator(".crate-toast-title")).toHaveCSS(
    "font-size",
    "14px",
  );
  await expect(toast.locator(".crate-toast-title")).toHaveCSS(
    "font-family",
    /sans-serif/,
  );
  await expect(toast.locator(".crate-toast-description")).toHaveCSS(
    "font-size",
    "11.5px",
  );
  await expect(toast.locator(".crate-toast-description")).toHaveCSS(
    "font-family",
    /mono/i,
  );
  for (const [side, value] of [
    ["top", "12px"],
    ["bottom", "12px"],
    ["left", "16px"],
    ["right", "16px"],
  ]) {
    await expect(toast).toHaveCSS(`padding-${side}`, value);
  }
  await expect(toast).toHaveCSS("border-top-width", "1px");
  await expect(toast).toHaveCSS("border-radius", "14px");
  await toaster.evaluate((element) => {
    element.setAttribute("data-sonner-theme", "dark");
  });
  // Sonner may inject this unlayered rule after the app CSS in production.
  await page.addStyleTag({
    content: `
      [data-sonner-toaster][data-sonner-theme="dark"] [data-description] {
        color: rgb(232, 232, 232);
      }
    `,
  });
  const descriptionColors = await toast
    .locator(".crate-toast-description")
    .evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--text-muted)";
      element.append(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      return { actual: getComputedStyle(element).color, expected };
    });
  expect(descriptionColors.actual).toBe(descriptionColors.expected);

  await checkpoint
    .getByRole("button", { name: "Mostrar cola", exact: true })
    .click();
  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveAttribute("data-type", "info");
  await expect(toast.locator(".crate-toast-title")).toHaveText(
    "Análisis en cola",
  );
  await expect(toast.locator(".crate-toast-description")).toHaveText(
    "12 álbumes pendientes de procesar.",
  );
  await checkpoint
    .getByRole("button", { name: "Mostrar error", exact: true })
    .click();
  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveAttribute("data-type", "error");
  await expect(toast.locator(".crate-toast-title")).toHaveText(
    "No se ha podido completar la tarea",
  );
  await expect(toast.locator(".crate-toast-description")).toHaveText(
    "El servidor no está disponible.",
  );
  await expect(toast.locator("[data-icon]")).toHaveCount(0);
  const retry = toast.getByRole("button", { name: "Reintentar", exact: true });
  await expect(retry).toHaveClass(/crate-toast-action/);
  await expect(retry).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const bounds = await toast.boundingBox();
  const stage = await checkpoint.locator(".toast-preview-stage").boundingBox();
  expect(bounds).not.toBeNull();
  expect(stage).not.toBeNull();
  expect(bounds!.width).toBeLessThanOrEqual(380);
  expect(bounds!.x).toBeGreaterThanOrEqual(stage!.x - 1);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
    stage!.x + stage!.width + 1,
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  const screenshot = info.outputPath("checkpoint-1k.png");
  await checkpoint.screenshot({ path: screenshot, animations: "disabled" });
  await info.attach("Checkpoint 1K", {
    path: screenshot,
    contentType: "image/png",
  });

  await retry.click();
  await expect(
    checkpoint.getByText("Reintento solicitado", { exact: true }),
  ).toBeVisible();
  await checkpoint
    .getByRole("button", { name: "Mostrar guardado", exact: true })
    .click();
  await expect(toast).toHaveAttribute("data-type", "success");
  await checkpoint
    .getByRole("button", { name: "Limpiar avisos", exact: true })
    .click();
  await expect(checkpoint.locator("[data-sonner-toast]")).toHaveCount(0);
  await checkpoint
    .getByRole("button", { name: "Probar pila", exact: true })
    .click();
  const stack = toaster.locator(".crate-toast[data-sonner-toast]");
  const rear = toaster.locator('.crate-toast[data-front="false"]');
  const front = toaster.locator('.crate-toast[data-front="true"]');
  await expect(stack).toHaveCount(2);
  await expect(front).toHaveAttribute("data-mounted", "true");
  await expect(rear).toHaveAttribute("data-mounted", "true");
  await page.mouse.move(0, 0);
  await expect(rear).toHaveAttribute("data-expanded", "false");
  expect
    .soft(
      await rear
        .locator(".crate-toast-content")
        .evaluate((element) => getComputedStyle(element).opacity),
      "Collapsed rear toast content stays hidden behind the front card",
    )
    .toBe("0");
  await front.hover();
  await expect(rear).toHaveAttribute("data-expanded", "true");
  await expect(rear.locator(".crate-toast-content")).toHaveCSS("opacity", "1");
  await page.mouse.move(0, 0);
  await expect(rear).toHaveAttribute("data-expanded", "false");
  expect
    .soft(
      await rear
        .locator(".crate-toast-content")
        .evaluate((element) => getComputedStyle(element).opacity),
      "Leaving the stack hides the rear content again",
    )
    .toBe("0");

  await page.addStyleTag({
    content: "[data-sonner-toast] { outline: 0; }",
  });
  await page.keyboard.press("Alt+t");
  await expect(toaster).toBeFocused();
  await expect(rear).toHaveAttribute("data-expanded", "true");
  await page.keyboard.press("Tab");
  await expect(front).toBeFocused();
  const focusOutline = await front.evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--focus-ring)";
    element.append(probe);
    const expectedColor = getComputedStyle(probe).color;
    probe.remove();
    const style = getComputedStyle(element);
    return {
      width: style.outlineWidth,
      style: style.outlineStyle,
      color: style.outlineColor,
      expectedColor,
    };
  });
  expect
    .soft(focusOutline, "Keyboard toast focus survives Sonner's late reset")
    .toMatchObject({
      width: "2px",
      style: "solid",
      color: focusOutline.expectedColor,
    });
  await checkpoint
    .getByRole("button", { name: "Limpiar avisos", exact: true })
    .click();
  await expect(checkpoint.locator("[data-sonner-toast]")).toHaveCount(0);
  expect(writes, "The toast checkpoint uses local state only").toEqual([]);
}

test("presents the shared toast styles and actions without API writes", async ({
  page,
}, info) => {
  await expectToasterCheckpoint(page, info);
});

test.describe("toast touch layout", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test("keeps toasts inside their stage at 390px", async ({ page }, info) => {
    await expectToasterCheckpoint(page, info);
  });
});

async function expectSharedCleanupCheckpoint(page: Page, info: TestInfo) {
  await page.goto("/#limpieza");
  await page.evaluate(() => document.fonts.ready);
  const checkpoint = page.locator("section#limpieza");
  await expect(checkpoint).toHaveAccessibleName(
    "Checkpoint 1L, Limpieza de componentes",
  );
  await expect(
    checkpoint.getByRole("heading", {
      level: 2,
      name: "Una base compartida más limpia.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    checkpoint.getByText("La limpieza no cambia las pantallas actuales.", {
      exact: true,
    }),
  ).toBeVisible();

  for (const name of ["Código sin uso", "Retirados del paquete compartido"]) {
    const panel = checkpoint.getByRole("region", { name, exact: true });
    await expect(panel).toBeVisible();
    await expect(
      panel.getByRole("heading", { level: 3, name, exact: true }),
    ).toBeVisible();
  }

  const retired = checkpoint.getByRole("list", {
    name: "Componentes retirados",
    exact: true,
  });
  await expect(retired.getByRole("listitem")).toHaveCount(4);
  for (const name of ["OpsPageHero", "OpsPanel", "OpsStatTile", "ShowCard"]) {
    const label = retired.getByText(name, { exact: true });
    await expect(label).toHaveCount(1);
    await label.scrollIntoViewIfNeeded();
    await expect(label).toBeVisible();
  }

  expect(
    await checkpoint.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  const screenshot = info.outputPath("checkpoint-1l.png");
  await checkpoint.screenshot({ path: screenshot, animations: "disabled" });
  await info.attach("Checkpoint 1L", {
    path: screenshot,
    contentType: "image/png",
  });
}

test("presents the retired shared components without changing existing screens", async ({
  page,
}, info) => {
  await expectSharedCleanupCheckpoint(page, info);
});

test.describe("shared cleanup touch layout", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test("keeps the cleanup evidence readable at 390px without overflow", async ({
    page,
  }, info) => {
    await expectSharedCleanupCheckpoint(page, info);
  });
});

async function expectCrateIdentityCheckpoint(page: Page, info: TestInfo) {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method()) &&
      new URL(request.url()).pathname.startsWith("/api/")
    ) {
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  await page.goto("/#identidad");
  await page.evaluate(() => document.fonts.ready);
  const checkpoint = page.locator("section#identidad");
  await expect(checkpoint).toHaveAccessibleName(
    "Checkpoint 1M, Identidad de Crate",
  );
  await expect(
    checkpoint.getByRole("heading", {
      level: 2,
      name: "Una sola identidad. Tus preferencias se conservan.",
      exact: true,
    }),
  ).toBeVisible();
  const preferences = checkpoint.getByRole("region", {
    name: "Preferencias de la muestra",
    exact: true,
  });
  await expect(preferences).toBeVisible();
  await expect(preferences.getByRole("combobox")).toHaveCount(3);
  await expect(preferences.locator("select")).toHaveCount(0);

  const before = await checkpoint.evaluate((element) => {
    const css = getComputedStyle(element);
    return {
      accent: css.getPropertyValue("--accent-action").trim(),
      text: css.getPropertyValue("--text-primary").trim(),
      surface: css.getPropertyValue("--surface-canvas").trim(),
      storage: JSON.stringify(
        Object.entries(localStorage).sort(([a], [b]) => a.localeCompare(b)),
      ),
    };
  });
  await checkpoint
    .getByRole("button", { name: "Cargar preferencias antiguas", exact: true })
    .click();
  await expect(
    preferences.getByRole("combobox", { name: "Movimiento", exact: true }),
  ).toHaveText("Reducir movimiento");
  await expect(
    preferences.getByRole("combobox", { name: "Efectos", exact: true }),
  ).toHaveText("Desactivados");
  await expect(
    preferences.getByRole("combobox", {
      name: "Densidad del contenido",
      exact: true,
    }),
  ).toHaveText("Compacta");
  const after = await checkpoint.evaluate((element) => {
    const css = getComputedStyle(element);
    return {
      accent: css.getPropertyValue("--accent-action").trim(),
      text: css.getPropertyValue("--text-primary").trim(),
      surface: css.getPropertyValue("--surface-canvas").trim(),
      storage: JSON.stringify(
        Object.entries(localStorage).sort(([a], [b]) => a.localeCompare(b)),
      ),
    };
  });
  expect(
    after,
    "Legacy demo settings preserve the common identity and use isolated memory",
  ).toEqual(before);
  expect(after.accent).toBe("#06b6d4");
  expect(writes, "The identity checkpoint has no API mutations").toEqual([]);
  expect(
    await checkpoint.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  for (const name of ["Movimiento", "Efectos", "Densidad del contenido"]) {
    const control = preferences.getByRole("combobox", { name, exact: true });
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeVisible();
    const bounds = await control.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.width + bounds!.x).toBeLessThanOrEqual(
      await page.evaluate(() => innerWidth),
    );
  }
  // Fit the complete section only for the advisory image, after the touch-layout checks.
  const viewport = page.viewportSize()!;
  const sectionHeight = await checkpoint.evaluate((element) =>
    Math.ceil(element.getBoundingClientRect().height),
  );
  await page.setViewportSize({
    width: viewport.width,
    height: Math.max(viewport.height, sectionHeight + 64),
  });
  await checkpoint.scrollIntoViewIfNeeded();
  const screenshot = info.outputPath("checkpoint-1m.png");
  await checkpoint.screenshot({ path: screenshot, animations: "disabled" });
  await info.attach("Checkpoint 1M", {
    path: screenshot,
    contentType: "image/png",
  });
}

test("presents one Crate identity and migrates sample preferences without external writes", async ({
  page,
}, info) => {
  await expectCrateIdentityCheckpoint(page, info);
});

test.describe("fixed identity touch layout", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test("keeps identity and functional preferences readable at 390px", async ({
    page,
  }, info) => {
    await expectCrateIdentityCheckpoint(page, info);
  });
});
