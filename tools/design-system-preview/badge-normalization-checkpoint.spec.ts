import { test, expect } from "@playwright/test";

test("informative and genre text share the approved 12px size in the persistent mockup", async ({
  page,
}) => {
  await page.goto("/");
  const info = page.locator("#filas-y-chips .crate-info-badge").first();
  // Existing historical checkpoint also exercises the compatibility adapter.
  await expect(info).toBeAttached();
  await expect(info).toHaveCSS("font-size", "12px");
  await expect(info).toHaveCSS("line-height", "16px");
  await expect(info).toHaveCSS("height", "24px");
  const genre = page.locator(".genre-pill").first();
  await expect(genre).toHaveCSS("font-size", "12px");
});

for (const width of [375, 1000, 1464]) {
  test(`shared collection at ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width, height: 1100 },
      hasTouch: width === 375,
      isMobile: width === 375,
    });
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:5186/badge-normalization-demo.html");
    await page.evaluate(() => document.fonts.ready);
    const section = page.getByRole("region", {
      name: "Checkpoint 1AQ, etiquetas compartidas",
    });
    const quality = section.getByRole("article", {
      name: "QualityBadge",
      exact: true,
    });
    for (const label of ["HI-RES", "Lossless", "High", "MP3", "Low"])
      await expect(
        quality.getByText(label, { exact: true }).first(),
      ).toBeVisible();
    expect(
      await quality.locator('[title^="Streaming delivery quality"]').count(),
    ).toBe(2);
    const badges = section.locator(".crate-info-badge");
    expect(await badges.count()).toBeGreaterThanOrEqual(14);
    const geometry = await badges.evaluateAll((nodes) =>
      nodes.map((n) => {
        const s = getComputedStyle(n);
        return {
          kind: n.getAttribute("data-variant"),
          height: n.getBoundingClientRect().height,
          font: s.fontSize,
          line: s.lineHeight,
          family: s.fontFamily,
          weight: s.fontWeight,
          padding: [
            s.paddingTop,
            s.paddingRight,
            s.paddingBottom,
            s.paddingLeft,
          ],
        };
      }),
    );
    for (const g of geometry) {
      expect(g.height).toBe(24);
      expect(g.font).toBe("12px");
      expect(g.line).toBe("16px");
      expect(g.family).toContain("JetBrains Mono");
      expect(g.weight).toBe("400");
      expect(g.padding).toEqual(
        g.kind === "counter"
          ? ["3px", "6px", "3px", "6px"]
          : ["3px", "8px", "3px", "8px"],
      );
    }
    expect(await page.evaluate(() => window.innerWidth)).toBe(width);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await expect(
      section.getByText(
        "Metadato de longitud excepcional para comprobar el espacio disponible en móvil",
      ),
    ).toHaveAttribute("title", /Metadato de longitud excepcional/);
    for (const label of [
      "Solo disponibles",
      "Toda la biblioteca",
      "post-rock",
      "drone 0%",
      "noise 100%",
    ]) {
      const item = section
        .getByRole("button", { name: label, exact: true })
        .or(section.getByRole("radio", { name: label, exact: true }))
        .or(
          section
            .locator(".genre-pill")
            .filter({ hasText: new RegExp(`^${label.replace("%", "%")}$`) }),
        );
      await expect(item).toHaveCSS("font-size", "12px");
      expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(
        width === 375 ? 44 : 32,
      );
    }
    const toggle = section.getByRole("button", { name: "Solo disponibles" });
    await toggle.press("Space");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).toHaveCSS("background-color", "rgb(103, 232, 249)");
    const radio = section.getByRole("radio", { name: "Toda la biblioteca" });
    await radio.press("ArrowRight");
    await expect(
      section.getByRole("radio", { name: "Solo local" }),
    ).toBeChecked();
    await section.getByRole("button", { name: "ambient 42%" }).click();
    await expect(section.getByRole("status")).toHaveText(
      "Ambient seleccionado",
    );
    await section.getByRole("button", { name: "Retirar Ambient" }).click();
    await expect(section.getByRole("status")).toHaveText("Ambient retirado");
    await expect(
      section.getByRole("button", { name: "No disponible" }),
    ).toBeDisabled();
    await context.close();
  });
}

test("composite labels preserve titles, removal and overlay icon tones", async ({
  page,
}) => {
  await page.goto("/badge-normalization-demo.html");
  const narrow = page.getByLabel("Relación estrecha");
  const badge = narrow.locator('[data-slot="badge"]');
  const remove = narrow.getByRole("button", {
    name: "Retirar relación de muestra",
  });
  const boundary = await badge.boundingBox(),
    button = await remove.boundingBox();
  expect(button!.x).toBeGreaterThanOrEqual(boundary!.x);
  expect(button!.x + button!.width).toBeLessThanOrEqual(
    boundary!.x + boundary!.width,
  );
  await remove.click();
  await expect(page.getByRole("status")).toHaveText("Relación retirada");
  await expect(
    page.getByLabel("Alias estrecho").locator('[data-slot="badge"]'),
  ).toHaveAttribute("title", "alias: a-long-alias-with-composed-text");
  const offline = page.getByRole("article", { name: "Consumidores reales" });
  const color = async (label: string) =>
    offline
      .getByLabel(label, { exact: true })
      .locator("svg")
      .evaluate((n) => getComputedStyle(n).color);
  expect(await color("Offline copy failed")).not.toBe("rgb(241, 245, 249)");
  expect(await color("Available offline")).not.toBe("rgb(241, 245, 249)");
});

test("form captions are uppercase while editable values retain case", async ({
  page,
}) => {
  await page.goto("/badge-normalization-demo.html");
  const sample = page.getByRole("article", { name: "Labels y valores" });
  await expect(
    sample.getByText("Nombre de muestra", { exact: true }),
  ).toHaveCSS("text-transform", "uppercase");
  await expect(sample.getByRole("textbox")).toHaveCSS("text-transform", "none");
  await expect(
    sample.getByText("First Song · FLAC", { exact: true }),
  ).toHaveCSS("text-transform", "uppercase");
  await expect(sample.getByRole("textbox")).toHaveValue("First Song");
  await sample.getByRole("checkbox").check();
  await expect(sample.getByRole("checkbox")).toBeChecked();
});
