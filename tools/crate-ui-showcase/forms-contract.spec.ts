import { expect, test } from "@playwright/test";

test("MonoLabel owns uppercase while keeping the original text", async ({
  page,
}) => {
  await page.goto(
    "/iframe.html?id=components-monolabel--uppercase-contract&viewMode=story",
  );
  for (const size of ["label", "eyebrow"]) {
    for (const override of ["normal-case", "lowercase", "capitalize"]) {
      const text = `Natural case ${size} ${override}`;
      const caption = page.getByText(text, { exact: true });
      await expect(caption).toHaveCSS("text-transform", "uppercase");
      await expect(caption).toHaveText(text);
    }
  }
});

for (const width of [390, 768, 1200]) {
  for (const coarse of [false, true]) {
    test.describe(`${width}px ${coarse ? "coarse" : "fine"}`, () => {
      test.use({ viewport: { width, height: 1000 }, hasTouch: coarse });
      test("form components own typography, geometry and real label gaps", async ({
        page,
      }) => {
        await page.goto(
          "/iframe.html?id=patterns-forms--typography-context&viewMode=story",
        );
        const name = page.getByRole("textbox", {
          name: "Playlist name",
          exact: true,
        });
        await expect(name).toBeVisible();
        for (const control of [
          name,
          page.getByRole("combobox", { name: "Source", exact: true }),
          page.getByRole("combobox", { name: "Genre", exact: true }),
          page.getByRole("searchbox", { name: "Search tracks", exact: true }),
        ]) {
          await expect(control).toHaveCSS("height", coarse ? "44px" : "40px");
          await expect(control).toHaveCSS("font-family", /IBM Plex Sans/);
          await expect(control).toHaveCSS("font-size", "15px");
          await expect(control).toHaveCSS("line-height", "21px");
          await expect(control).toHaveCSS("font-weight", "400");
        }
        const caption = page
          .locator('[data-slot="form-field-label"]')
          .filter({ hasText: "Playlist name" })
          .locator("span")
          .first();
        await expect(caption).toHaveCSS("font-family", /JetBrains/);
        await expect(caption).toHaveCSS("font-size", "11px");
        await expect(caption).toHaveCSS("font-weight", "400");
        await expect(caption).toHaveCSS("text-transform", "uppercase");
        const fieldType = await caption.evaluate((el) => {
          const css = getComputedStyle(el);
          return [
            css.fontFamily,
            css.fontSize,
            css.lineHeight,
            css.fontWeight,
            css.letterSpacing,
            css.textTransform,
            css.color,
          ];
        });
        for (const option of [
          "Keep queue",
          "Automatic playback",
          "Lossless",
          "Compressed",
        ]) {
          const optionType = await page
            .getByText(option, { exact: true })
            .evaluate((el) => {
              const css = getComputedStyle(el);
              return [
                css.fontFamily,
                css.fontSize,
                css.lineHeight,
                css.fontWeight,
                css.letterSpacing,
                css.textTransform,
                css.color,
              ];
            });
          expect(optionType).toEqual(fieldType);
        }
        await expect(
          page.getByText("Between 2 and 40 characters.", { exact: true }),
        ).toHaveCSS("font-weight", "400");
        for (const field of await page
          .locator('[data-slot="form-field"][data-layout="stacked"]')
          .all()) {
          const gap = await field.evaluate((el) => {
            const label = el.querySelector('[data-slot="form-field-label"]')!;
            const control = label.nextElementSibling!;
            return (
              control.getBoundingClientRect().top -
              label.getBoundingClientRect().bottom
            );
          });
          expect(gap).toBeCloseTo(8, 1);
        }
        const value = page.getByRole("status", { name: "Library path" });
        await expect(value).toHaveCSS("font-family", /IBM Plex Sans/);
        await expect(value).toHaveCSS("font-size", "15px");
        await expect(value).toHaveCSS("font-weight", "400");
        await expect(page.locator(".crate-readout")).toHaveCSS(
          "font-weight",
          "400",
        );
        await expect(page.getByText("Bit depth", { exact: true })).toHaveCSS(
          "font-weight",
          "400",
        );
        await expect(
          page.getByRole("radio", { name: "All", exact: true }),
        ).toHaveCSS("font-weight", "400");
        await expect(
          page.getByRole("button", { name: "Ambient filter" }),
        ).toHaveCSS("font-size", "12px");
        await expect(page.getByRole("slider", { name: "Crossfade" })).toHaveCSS(
          "height",
          coarse ? "44px" : "40px",
        );
        expect(
          await page
            .locator("body")
            .evaluate((el) => el.scrollWidth <= window.innerWidth),
        ).toBe(true);
      });
      test("binary and radio controls share the accent and an accessible coarse hit area", async ({
        page,
      }) => {
        await page.goto(
          "/iframe.html?id=patterns-forms--complete&viewMode=story",
        );
        const checkbox = page.getByRole("checkbox", { name: "Keep queue" });
        const radio = page.getByRole("radio", {
          name: "Lossless",
          exact: true,
        });
        await expect(checkbox).toHaveCSS("width", "18px");
        await expect(radio).toHaveCSS("width", "18px");
        expect(
          await radio.evaluate((el) => getComputedStyle(el).borderColor),
        ).toBe(
          await checkbox.evaluate((el) => getComputedStyle(el).borderColor),
        );
        if (coarse) {
          for (const item of [
            checkbox,
            radio,
            page.getByRole("switch", { name: "Automatic playback" }),
          ]) {
            const hit = await item.evaluate((el) => ({
              width: getComputedStyle(el, "::after").width,
              height: getComputedStyle(el, "::after").height,
            }));
            expect(hit).toEqual({ width: "44px", height: "44px" });
          }
        }
      });
    });
  }
}

test("form validation, readonly search, slider keys and radio roving preserve their contracts", async ({
  page,
}) => {
  await page.goto("/iframe.html?id=patterns-forms--complete&viewMode=story");
  await expect(
    page.getByRole("searchbox", { name: "Read-only query" }),
  ).toHaveValue("ambient");
  await expect(page.getByRole("button", { name: "Clear search" })).toHaveCount(
    0,
  );
  const slider = page.getByRole("slider", { name: "Crossfade" });
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue("4.5");
  await slider.press("End");
  await expect(slider).toHaveValue("12");
  await slider.press("Home");
  await expect(slider).toHaveValue("0");
  const lossless = page.getByRole("radio", { name: "Lossless", exact: true });
  await lossless.focus();
  await page.keyboard.down("ArrowDown");
  await expect(
    page.getByRole("radio", { name: "Compressed", exact: true }),
  ).toBeFocused();
  await page.keyboard.up("ArrowDown");
  await expect(
    page.getByRole("radio", { name: "Compressed", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Validate sample" }).click();
  await expect(
    page.getByRole("textbox", { name: "Playlist name", exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByRole("textbox", { name: "Playlist name", exact: true }),
  ).toHaveAccessibleDescription(
    "Between 2 and 40 characters. A playlist name is required.",
  );
});
test("select portals stay above controls, select by keyboard and return focus", async ({
  page,
}) => {
  await page.goto("/iframe.html?id=patterns-forms--complete&viewMode=story");
  const trigger = page.getByRole("combobox", { name: "Source", exact: true });
  await trigger.focus();
  await trigger.press("ArrowDown");
  const list = page.getByRole("listbox");
  await expect(list).toBeVisible();
  await page
    .getByRole("option", { name: "Archive", exact: true })
    .press("Enter");
  await expect(trigger).toBeFocused();
  await expect(trigger).toContainText("Archive");
  const searchable = page.getByRole("combobox", { name: "Genre", exact: true });
  await searchable.click();
  await page.getByRole("searchbox", { name: "Search genres" }).fill("drone");
  await expect(page.getByRole("option", { name: /Ambient/ })).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Search genres" })
    .press("ArrowDown");
  await page.getByRole("option", { name: /Choose a genre/ }).press("ArrowDown");
  await page.getByRole("option", { name: /Ambient/ }).press("Enter");
  await expect(searchable).toBeFocused();
});
test("all form entries resolve to real documentation and expose the review checkpoint", async ({
  page,
}) => {
  const ids = [
    "formfield",
    "input",
    "textarea",
    "searchinput",
    "select",
    "adminselect",
    "checkbox",
    "switch",
    "radiogroup",
    "slider",
    "segmentedcontrol",
    "filterchip",
  ];
  for (const id of ids) {
    await page.goto(`/iframe.html?id=components-${id}--docs&viewMode=docs`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByText("Visual review pending · 1AR", { exact: true }),
    ).toBeVisible();
  }
});

test("checkbox caption sits beside the control using the shared inline contract", async ({
  page,
}) => {
  await page.goto("/iframe.html?id=components-checkbox--base&viewMode=story");
  const box = page.getByRole("checkbox", { name: "Keep the queue" }),
    label = page.locator('[data-slot="form-field-label"]');
  const b = await box.boundingBox(),
    l = await label.boundingBox();
  expect(b).not.toBeNull();
  expect(l).not.toBeNull();
  expect(l!.x).toBeGreaterThanOrEqual(b!.x + b!.width + 16);
  expect(Math.abs(l!.y + l!.height / 2 - (b!.y + b!.height / 2))).toBeLessThan(
    2,
  );
  await expect(label).toHaveCSS("font-family", /JetBrains/);
  await expect(label).toHaveCSS("font-size", "11px");
  await label.click();
  await expect(box).toBeChecked();
});
test("searchable select exposes long option text without clipping it", async ({
  page,
}) => {
  await page.goto(
    "/iframe.html?id=components-adminselect--base&viewMode=story",
  );
  await page.getByRole("combobox", { name: "Genre", exact: true }).click();
  const text = page
    .getByRole("option", {
      name: "A long translated option that must fit inside its menu",
    })
    .locator("span")
    .first();
  expect(await text.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
});
test.describe("coarse radio spacing", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 1000 } });
  test("touch targets do not overlap adjacent choices", async ({ page }) => {
    await page.goto("/iframe.html?id=patterns-forms--complete&viewMode=story");
    const first = await page
        .getByRole("radio", { name: "Lossless", exact: true })
        .boundingBox(),
      second = await page
        .getByRole("radio", { name: "Compressed", exact: true })
        .boundingBox();
    expect(second!.y - first!.y).toBeGreaterThanOrEqual(44);
  });
});

test("segmented tabs keep linked panels and skip disabled items", async ({
  page,
}) => {
  await page.goto(
    "/iframe.html?id=components-segmentedcontrol--tabs&viewMode=story",
  );
  const all = page.getByRole("tab", { name: "Entire library" });
  const local = page.getByRole("tab", { name: "Local only" });
  await expect(page.locator("#panel-local")).toBeHidden();
  await all.focus();
  await all.press("ArrowRight");
  await expect(local).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#panel-local")).toBeVisible();
  await expect(page.locator("#panel-all")).toBeHidden();
  await local.press("ArrowRight");
  await expect(all).toHaveAttribute("aria-selected", "true");
  await expect(all).toHaveAttribute("aria-controls", "panel-all");
});

test("filter selection uses the shared accent recipe", async ({ page }) => {
  await page.goto("/iframe.html?id=patterns-forms--complete&viewMode=story");
  const filter = page.getByRole("button", { name: "Ambient filter" });
  await filter.click();
  await expect(filter).toHaveAttribute("aria-pressed", "true");
  await expect(filter).toHaveCSS("background-color", "rgb(103, 232, 249)");
});

test("select invalid and unknown values preserve the field contract", async ({
  page,
}) => {
  await page.goto("/iframe.html?id=components-select--invalid&viewMode=story");
  const invalid = page.getByRole("combobox", { name: "Audio format" });
  await expect(invalid).toHaveAttribute("aria-invalid", "true");
  await expect(invalid).toHaveAccessibleDescription(
    "Choose an available format.",
  );
  await page.goto(
    "/iframe.html?id=components-select--unknown-value&viewMode=story",
  );
  await page.getByRole("combobox", { name: "Audio format" }).click();
  await expect(page.getByRole("option", { selected: true })).toHaveCount(0);
});

test("select portal escapes a narrow scrolling scene", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto(
    "/iframe.html?id=components-select--long-option&viewMode=story",
  );
  const region = page.locator('[data-scene="scroll-region"]');
  await region.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const trigger = page.getByRole("combobox", { name: "Source", exact: true });
  await trigger.click();
  const menu = page.getByRole("listbox");
  await expect(menu).toBeVisible();
  expect(
    await menu.evaluate(
      (el) => el.closest('[data-scene="scroll-region"]') === null,
    ),
  ).toBe(true);
  const rect = await menu.boundingBox();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});
