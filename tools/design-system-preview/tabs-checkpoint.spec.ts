import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test.describe(`text tabs ${width}`, () => {
    test.use({
      viewport: { width, height: 1000 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });

    test("checkpoint 1Q shares text styling, keyboard and real URL navigation", async ({
      page,
    }, info) => {
      const apiRequests: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("/api/")) apiRequests.push(request.url());
      });
      await page.addInitScript(() => {
        const writes: string[] = [];
        Reflect.set(window, "__tabsStorageWrites", writes);
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          writes.push(key);
          return original.call(this, key, value);
        };
      });
      await page.goto(
        "/?tab=albums&listenTab=overview&node=peer&tag=a&tag=b#pestanas",
      );
      const section = page.getByRole("region", {
        name: "Checkpoint 1Q, Pestañas",
      });
      await section.scrollIntoViewIfNeeded();
      if (width === 390) {
        const heading = section.locator(".specimen-heading");
        const title = await heading.locator("h2").boundingBox();
        const description = await heading.locator(":scope > p").boundingBox();
        expect(
          description!.y - (title!.y + title!.height),
        ).toBeGreaterThanOrEqual(16);
      }
      const admin = section.getByRole("tablist", { name: "Paneles de Admin" });
      const listen = section.getByRole("tablist", {
        name: "Paneles de Listen",
      });
      const active = admin.getByRole("tab", { selected: true });
      await expect(active).toHaveText("Discografía");
      await expect(listen.getByRole("tab", { selected: true })).toHaveText(
        "Resumen",
      );
      await expect(active).toHaveCSS("font-size", "11.5px");
      await expect(active).toHaveCSS("font-weight", "400");
      await expect(active).toHaveCSS("text-transform", "uppercase");
      expect(
        await active.evaluate((el) => getComputedStyle(el).fontFamily),
      ).toContain("JetBrains Mono");
      for (const list of [admin, listen]) {
        await expect(list).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        await expect(list).toHaveCSS("backdrop-filter", "none");
        expect(
          await list.evaluate((el) => el.scrollWidth > el.clientWidth),
        ).toBe(width === 390);
        for (const tab of await list.getByRole("tab").all()) {
          const box = (await tab.boundingBox())!;
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.width).toBeGreaterThanOrEqual(44);
          await expect(tab).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
          await expect(tab).toHaveCSS("box-shadow", "none");
        }
      }
      const underline = await active.evaluate((el) => {
        const style = getComputedStyle(el, "::after");
        const expected = document.createElement("span");
        expected.style.color = "var(--accent-action-hi)";
        el.append(expected);
        const color = getComputedStyle(expected).color;
        expected.remove();
        return {
          height: style.height,
          color: style.backgroundColor,
          opacity: style.opacity,
          expected: color,
        };
      });
      expect(underline.height).toBe("2px");
      expect(underline.color).toBe(underline.expected);
      expect(underline.opacity).toBe("1");
      await active.focus();
      await page.keyboard.press("ArrowRight");
      await expect(
        admin.getByRole("tab", { name: "Conciertos", exact: true }),
      ).toBeFocused();
      await expect(admin.getByRole("tab", { selected: true })).toHaveCSS(
        "outline-style",
        "solid",
      );
      await expect(
        section.getByRole("tabpanel", { name: "Conciertos" }),
      ).toBeVisible();
      await expect(admin.getByRole("tab", { selected: true })).toHaveCSS(
        "outline-offset",
        "-2px",
      );
      const url = new URL(page.url());
      expect(url.searchParams.get("tab")).toBe("shows");
      expect(url.searchParams.get("node")).toBe("peer");
      expect(url.searchParams.getAll("tag")).toEqual(["a", "b"]);
      expect(url.hash).toBe("#pestanas");
      await page.goBack();
      await expect(admin.getByRole("tab", { selected: true })).toHaveText(
        "Discografía",
      );
      await page.goForward();
      await expect(admin.getByRole("tab", { selected: true })).toHaveText(
        "Conciertos",
      );
      await listen.getByRole("tab", { name: "Resumen", exact: true }).focus();
      await page.keyboard.press("End");
      await expect(listen.getByRole("tab", { selected: true })).toHaveText(
        "Historial",
      );
      await page.keyboard.press("ArrowRight");
      await expect(listen.getByRole("tab", { selected: true })).toHaveText(
        "Resumen",
      );
      await section
        .getByRole("link", { name: "Probar enlace directo" })
        .click();
      await expect(listen.getByRole("tab", { selected: true })).toHaveText(
        "Discografía",
      );
      await section
        .getByRole("link", { name: "Probar valor desconocido" })
        .click();
      await expect(admin.getByRole("tab", { selected: true })).toHaveText(
        "Resumen",
      );
      await expect(listen.getByRole("tab", { selected: true })).toHaveText(
        "Resumen",
      );
      expect(new URL(page.url()).searchParams.get("tab")).toBe("unknown");
      await section
        .getByRole("button", { name: "Anterior", exact: true })
        .click();
      await expect(listen.getByRole("tab", { selected: true })).toHaveText(
        "Discografía",
      );
      await section
        .getByRole("button", { name: "Siguiente", exact: true })
        .click();
      await expect(listen.getByRole("tab", { selected: true })).toHaveText(
        "Resumen",
      );
      const gap = await section
        .getByRole("status", { name: "URL de muestra" })
        .evaluate(
          (el) =>
            el.getBoundingClientRect().top -
            el.previousElementSibling!.getBoundingClientRect().bottom,
        );
      expect(gap).toBe(8);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(apiRequests).toEqual([]);
      expect(
        await page.evaluate(() => Reflect.get(window, "__tabsStorageWrites")),
      ).toEqual([]);
      const image = info.outputPath(`checkpoint-1q-${width}.png`);
      await section.screenshot({ path: image, animations: "disabled" });
      await info.attach("Checkpoint 1Q advisory", {
        path: image,
        contentType: "image/png",
      });
    });
  });
}

test("text tabs retain inset focus and a visible marker with forced colors and reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.goto("/#pestanas");
  const list = page.getByRole("tablist", { name: "Paneles de Admin" });
  await list.getByRole("tab", { name: "Resumen", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  const selected = list.getByRole("tab", { selected: true });
  await expect(selected).toHaveText("Discografía");
  await expect(selected).toBeFocused();
  await expect(selected).toHaveCSS("outline-width", "2px");
  await expect(selected).toHaveCSS("outline-offset", "-2px");
  await expect(selected).not.toHaveAttribute("data-crate-focus-motion");
  const marker = await selected.evaluate((el) => {
    const style = getComputedStyle(el, "::after");
    return {
      height: style.height,
      opacity: style.opacity,
      color: style.backgroundColor,
    };
  });
  expect(marker.height).toBe("2px");
  expect(marker.opacity).toBe("1");
  expect(marker.color).not.toBe("rgba(0, 0, 0, 0)");
});
