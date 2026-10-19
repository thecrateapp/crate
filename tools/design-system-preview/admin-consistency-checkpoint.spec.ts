import { expect, test, type Page } from "@playwright/test";

async function openPage(page: Page, name: string) {
  await page.goto(`/admin-${name}-demo.html`);
  await expect(page.locator("h1").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function openUserDetail(page: Page) {
  await page
    .getByRole("row", { name: /Ada Costa/ })
    .getByRole("button", { name: "Inspect", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "User Detail", exact: true })
      .getByText("Fictional user for the local preview."),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "User Detail", exact: true })
    .evaluate((element) =>
      Promise.all(
        element.getAnimations().map((animation) => animation.finished),
      ),
    );
}

async function openTranslationEditor(page: Page) {
  await page.getByRole("tab", { name: "Bundles", exact: true }).click();
  await page.getByRole("button", { name: "Review es", exact: true }).click();
  await expect(
    page.getByRole("textbox", {
      name: "Translation for player.play",
      exact: true,
    }),
  ).toBeVisible();
}

async function typographyViolations(page: Page) {
  return page.evaluate(() => {
    const visible = (element: Element) => {
      if (
        !element.getClientRects().length ||
        getComputedStyle(element).visibility === "hidden"
      )
        return false;
      for (
        let parent = element.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        if (
          parent.tagName === "DETAILS" &&
          !(parent as HTMLDetailsElement).open &&
          !parent.querySelector("summary")?.contains(element)
        )
          return false;
      }
      return true;
    };
    return Array.from(document.querySelectorAll(".font-mono,.font-display"))
      .filter(visible)
      .flatMap((element) => {
        const style = getComputedStyle(element);
        const family = style.fontFamily.split(",")[0]!.replace(/"/g, "").trim();
        const size = parseFloat(style.fontSize);
        const text = element.textContent?.replace(/\s+/g, " ").trim();
        if (family === "JetBrains Mono" && style.fontWeight !== "400")
          return [{ text, family, size, weight: style.fontWeight }];
        if (
          family === "Bricolage Grotesque" &&
          size < 20 &&
          !(element.classList.contains("tabular-nums") && size >= 16)
        )
          return [{ text, family, size, weight: style.fontWeight }];
        return [];
      });
  });
}

for (const width of [1440, 390]) {
  test.describe(`1AP reconciliation ${width}`, () => {
    test.use({ viewport: { width, height: 1100 } });

    // A white/alpha child override on an accent-filled selected control must fail this.
    test("selected and unselected playlist counts remain readable", async ({
      page,
    }) => {
      await openPage(page, "playlists");
      for (const [index, name] of [
        /^All\s*5$/,
        /^Curated\s*4$/,
        /^Smart\s*3$/,
        /^Inactive\s*1$/,
      ].entries()) {
        const pill = page.getByRole("button", { name });
        for (const selected of [false, true]) {
          if (selected) await pill.click();
          else
            await page
              .getByRole("button", {
                name: index === 0 ? /^Curated\s*4$/ : /^All\s*5$/,
              })
              .click();
          await expect(pill).toHaveAttribute("aria-pressed", String(selected));
          await pill.evaluate((element) =>
            Promise.all(
              element
                .getAnimations({ subtree: true })
                .map((animation) => animation.finished),
            ),
          );
          const contrast = await pill.evaluate((element) => {
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 1;
            const context = canvas.getContext("2d")!;
            const layers: Element[] = [];
            for (
              let node: Element | null = element;
              node;
              node = node.parentElement
            )
              layers.unshift(node);
            context.fillStyle = "white";
            context.fillRect(0, 0, 1, 1);
            for (const node of layers) {
              context.fillStyle = getComputedStyle(node).backgroundColor;
              context.fillRect(0, 0, 1, 1);
            }
            const background = Array.from(
              context.getImageData(0, 0, 1, 1).data,
            );
            context.fillStyle = getComputedStyle(
              element.querySelector("span")!,
            ).color;
            context.fillRect(0, 0, 1, 1);
            const foreground = Array.from(
              context.getImageData(0, 0, 1, 1).data,
            );
            const luminance = (rgb: number[]) =>
              rgb
                .slice(0, 3)
                .map((value) => value / 255)
                .map((value) =>
                  value <= 0.04045
                    ? value / 12.92
                    : ((value + 0.055) / 1.055) ** 2.4,
                )
                .reduce(
                  (sum, value, index) =>
                    sum + value * [0.2126, 0.7152, 0.0722][index]!,
                  0,
                );
            const a = luminance(background),
              b = luminance(foreground);
            return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          });
          expect(
            contrast,
            `${name} count, selected=${selected}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    // These real consumer states catch inherited Badge weights and small display roles.
    test("Mono stays 400 and compact titles use the body face", async ({
      page,
    }) => {
      for (const name of [
        "navigation",
        "roles",
        "users",
        "translations",
        "bandcamp",
        "upcoming",
        "health",
        "analysis",
      ]) {
        await openPage(page, name);
        expect.soft(await typographyViolations(page), name).toEqual([]);
        if (name === "users") {
          await openUserDetail(page);
          expect
            .soft(await typographyViolations(page), "User Detail")
            .toEqual([]);
        }
        if (name === "translations") {
          await openTranslationEditor(page);
          expect
            .soft(await typographyViolations(page), "Translations editor")
            .toEqual([]);
        }
        if (name === "health") {
          await page
            .locator("summary")
            .filter({ hasText: "Available checks" })
            .click();
          expect
            .soft(await typographyViolations(page), "Health available checks")
            .toEqual([]);
        }
      }
    });

    test("static tags keep the shared type and geometry in Analysis and User Detail", async ({
      page,
    }) => {
      for (const name of ["analysis", "users"]) {
        await openPage(page, name);
        if (name === "users") await openUserDetail(page);
        const root =
          name === "users"
            ? page.getByRole("dialog", { name: "User Detail", exact: true })
            : page.locator("body");
        const tags = root.locator("span.rounded-full.font-mono");
        await expect(tags.first()).toBeVisible();
        const metrics = await tags.evaluateAll((elements) =>
          elements
            .filter((element) => element.getClientRects().length)
            .map((element) => {
              const style = getComputedStyle(element);
              return {
                text: element.textContent?.trim(),
                height: element.getBoundingClientRect().height,
                size: style.fontSize,
                line: style.lineHeight,
                weight: style.fontWeight,
              };
            }),
        );
        expect(metrics.length).toBeGreaterThan(0);
        expect(
          metrics.some(
            (tag) =>
              tag.text === (name === "analysis" ? "90% cache" : "listen-web"),
          ),
        ).toBe(true);
        expect(
          metrics.filter(
            (tag) =>
              tag.height !== 16 ||
              tag.size !== "10px" ||
              tag.line !== "10px" ||
              tag.weight !== "400",
          ),
          name,
        ).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      }
    });

    test("the shared tag owns its weight and line height inside a heavy parent", async ({
      page,
    }) => {
      await openPage(page, "playlists");
      const tag = page.getByText("Etiqueta de muestra", { exact: true });
      expect(
        await tag.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            weight: style.fontWeight,
            line: style.lineHeight,
            height: element.getBoundingClientRect().height,
          };
        }),
      ).toEqual({ weight: "400", line: "10px", height: 16 });
    });
  });
}
