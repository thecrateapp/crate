import { expect, test, type Locator } from "@playwright/test";
async function expectTouchTarget(target: Locator) {
  await expect
    .poll(async () => {
      const box = await target.boundingBox();
      return box ? Math.min(box.width, box.height) : 0;
    })
    .toBeGreaterThanOrEqual(44);
}

async function expectBalancedCounter(link: Locator) {
  const badge = link.locator('[data-slot="badge"]');
  const insets = await badge.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const range = document.createRange();
    range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    const context = document.createElement("canvas").getContext("2d")!;
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const metrics = context.measureText(element.textContent!.trim());
    const baseline = text.top + metrics.fontBoundingBoxAscent;
    return {
      left:
        text.left -
        metrics.actualBoundingBoxLeft -
        box.left -
        parseFloat(style.borderLeftWidth),
      right:
        box.right -
        parseFloat(style.borderRightWidth) -
        text.left -
        metrics.actualBoundingBoxRight,
      top:
        baseline -
        metrics.actualBoundingBoxAscent -
        box.top -
        parseFloat(style.borderTopWidth),
      bottom:
        box.bottom -
        parseFloat(style.borderBottomWidth) -
        baseline -
        metrics.actualBoundingBoxDescent,
    };
  });
  const spaces = Object.values(insets);
  await test.info().attach(`counter-${await badge.innerText()}`, {
    body: JSON.stringify(insets),
    contentType: "application/json",
  });
  expect
    .soft(Math.min(...spaces), JSON.stringify(insets))
    .toBeGreaterThanOrEqual(4);
  expect
    .soft(Math.max(...spaces) - Math.min(...spaces), JSON.stringify(insets))
    .toBeLessThanOrEqual(1.5);
}

async function expectCurrentPageMarker(link: Locator) {
  await expect(link).toHaveAttribute("aria-current", "page");
  const marker = await link.evaluate((element) => {
    const style = getComputedStyle(element, "::before");
    return {
      width: style.width,
      color: style.backgroundColor,
      content: style.content,
    };
  });
  expect.soft(marker.width).toBe("2px");
  expect.soft(marker.color).not.toBe("rgba(0, 0, 0, 0)");
  expect.soft(marker.content).not.toBe("none");
}
for (const width of [1440, 768, 390]) {
  test.describe(`Admin text navigation ${width}`, () => {
    test.use({
      viewport: { width, height: 1000 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    test("1W keeps real labels, routes, palette keys and no live API", async ({
      page,
    }, info) => {
      const errors: string[] = [],
        requests: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (request.url().includes("/api/")) requests.push(request.url());
      });
      await page.goto("/admin-navigation-demo.html");
      await expect(
        page.getByRole("heading", { name: "Navegación de Admin" }),
      ).toBeVisible();
      const main = page.getByRole("main");
      const route = page.getByLabel("Ruta de muestra");
      if (width >= 768) {
        await page.getByRole("button", { name: "Collapse sidebar" }).click();
        const nav = page.getByRole("navigation", { name: "Admin navigation" });
        await expect(nav.locator("svg")).toHaveCount(0);
        const link = nav.getByRole("link", { name: "System Playlists" });
        await expect(link).toHaveText("System Playlists");
        const box = await link.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        await link.click();
        await expect(route).toHaveText("/playlists");
        await expect(main).toHaveCSS("margin-left", "144px");
        await page.getByRole("button", { name: "Go back" }).click();
        await expect(route).toHaveText("/tasks?tab=running#sample");
        await page.getByRole("button", { name: "Go forward" }).click();
        await expect(route).toHaveText("/playlists");
        await page.getByRole("button", { name: "Expand sidebar" }).click();
        await expect(main).toHaveCSS("margin-left", "240px");
        const search = page.getByPlaceholder("Search library…");
        const searchBox = await search.boundingBox();
        expect(searchBox!.x + searchBox!.width).toBeLessThanOrEqual(width);
      } else {
        const trigger = page.getByRole("button", { name: "Open navigation" });
        await expect(trigger.locator("svg")).toHaveCount(1);
        await trigger.click();
        const drawer = page.getByRole("dialog", {
          name: "Navigation",
          exact: true,
        });
        await expect(
          drawer
            .getByRole("button", { name: "Close navigation" })
            .locator("svg"),
        ).toHaveCount(1);
        await expectTouchTarget(
          drawer.getByRole("button", { name: "Close navigation" }),
        );
        await drawer.getByRole("link", { name: "Browse", exact: true }).click();
        await expect(drawer).not.toBeVisible();
        await expect(route).toHaveText("/browse");
        await trigger.click();
        await page.keyboard.press("Escape");
        await expect(drawer).not.toBeVisible();
        await expect(trigger).toBeFocused();
      }
      await page
        .getByRole("button", { name: "Abrir paleta de muestra" })
        .click();
      const dialog = page.getByRole("dialog", { name: "Command palette" });
      await expect(dialog.locator("svg")).toHaveCount(2);
      await expectTouchTarget(
        dialog.getByRole("button", { name: "Close command palette" }),
      );
      await expect(dialog.getByRole("option").locator("svg")).toHaveCount(0);
      const input = dialog.getByRole("combobox", { name: "Search commands" });
      await expect(input).toBeFocused();
      await expect(input).toHaveCSS("outline-style", "solid");
      await expect(input).toHaveCSS("outline-width", "2px");
      const focusOverflow = await input.evaluate((element) => {
        const style = getComputedStyle(element);
        const field = element.getBoundingClientRect();
        const row = element.parentElement!.getBoundingClientRect();
        const outward = Math.max(
          0,
          parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset),
        );
        return Math.max(
          row.top - field.top + outward,
          field.bottom + outward - row.bottom,
          row.left - field.left + outward,
          field.right + outward - row.right,
        );
      });
      expect(focusOverflow).toBeLessThanOrEqual(0.5);
      await input.fill("sync lib");
      await expect(
        dialog.getByRole("option", { name: "Sync Library" }),
      ).toHaveText("Sync Library");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect(dialog).not.toBeVisible();
      await page.keyboard.press("ControlOrMeta+k");
      await dialog
        .getByRole("button", { name: "Close command palette" })
        .click();
      await expect(dialog).not.toBeVisible();
      const opener = page.getByRole("button", {
        name: "Abrir paleta de muestra",
      });
      await opener.focus();
      await page.keyboard.press("?");
      const help = page.getByRole("dialog", { name: "Keyboard Shortcuts" });
      await expect(help.locator("svg")).toHaveCount(1);
      const helpClose = help.getByRole("button", {
        name: "Close",
        exact: true,
      });
      await expectTouchTarget(helpClose);
      await helpClose.focus();
      await page.keyboard.press("?");
      await helpClose.click();
      await expect(opener).toBeFocused();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(requests).toEqual([]);
      expect(errors).toEqual([]);
      await info.attach("checkpoint-1w", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    });
    test("counters have balanced ink spacing and the current destination stays marked", async ({
      page,
    }) => {
      await page.goto("/admin-navigation-demo.html");
      await expect(
        page.getByRole("heading", { name: "Navegación de Admin" }),
      ).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      if (width < 768)
        await page.getByRole("button", { name: "Open navigation" }).click();
      const nav = page.getByRole("navigation", { name: "Admin navigation" });
      const tasks = nav.getByRole("link", { name: /^Tasks/ });
      const health = nav.getByRole("link", { name: /^Library Health/ });
      await expectBalancedCounter(health);
      await expectBalancedCounter(tasks);
      await expectCurrentPageMarker(tasks);
      if (width >= 768) {
        await page.getByRole("button", { name: "Collapse sidebar" }).click();
        await expectBalancedCounter(health);
        await expectBalancedCounter(tasks);
        await expectCurrentPageMarker(tasks);
      }
      await health.click();
      if (width < 768)
        await page.getByRole("button", { name: "Open navigation" }).click();
      await expectCurrentPageMarker(health);
      await expect(tasks).not.toHaveAttribute("aria-current", "page");
      expect(
        await tasks.evaluate(
          (element) => getComputedStyle(element, "::before").content,
        ),
      ).toBe("none");
    });
  });
}
test("persistent 1W specimen embeds the isolated real Admin entry", async ({
  page,
}) => {
  await page.goto("/?tab=albums&listenTab=history#navegacion-admin");
  const section = page.getByRole("region", {
    name: "Checkpoint 1W, Navegación de Admin por texto",
  });
  await expect(section).toBeVisible();
  const frame = page.frameLocator(
    'iframe[title="Navegación real de Admin con datos de muestra"]',
  );
  await expect(
    frame.getByRole("heading", { name: "Navegación de Admin" }),
  ).toBeVisible();
});
