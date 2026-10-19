import { expect, test } from "@playwright/test";

test("the 1AR preview covers the whole form family", async ({ page }) => {
  await page.goto("/review-1ar-labels.html");
  await expect(page.getByRole("slider", { name: "Crossfade" })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Description" }),
  ).toBeVisible();
  await expect(
    page.getByRole("searchbox", { name: "Search tracks" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Audio format" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Genre", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("radiogroup", { name: "Listening mode" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ambient filter" }),
  ).toBeVisible();
});

for (const host of ["preview", "storybook"]) {
  for (const [width, touch] of [
    [390, true],
    [1200, false],
  ] as const) {
    test.describe(`${host} ${width}px`, () => {
      test.use({ viewport: { width, height: 1000 }, hasTouch: touch });
      test("the isolated form family uses shared components, retains values and activates controls", async ({
        page,
      }) => {
        const apiRequests: string[] = [];
        page.on("request", (request) => {
          if (new URL(request.url()).pathname.startsWith("/api/"))
            apiRequests.push(request.url());
        });
        await page.goto(
          host === "preview"
            ? "/review-1ar-forms.html"
            : "http://127.0.0.1:6006/iframe.html?id=reviews-1ar-field-labels--isolated&viewMode=story",
        );
        await expect(
          page.getByRole("heading", { name: "The complete form family." }),
        ).toBeVisible();
        await expect(page.locator("iframe")).toHaveCount(0);
        for (const name of [
          "Track name",
          "First Song · FLAC",
          "Automatic playback",
          "Source",
          "Library",
          "Archive",
        ]) {
          const caption = page.getByText(name, { exact: true });
          await expect(caption).toHaveCSS("text-transform", "uppercase");
          await expect(caption).toHaveCSS("font-family", /JetBrains/);
          await expect(caption).toHaveCSS("font-size", "11px");
        }
        const input = page.getByRole("textbox", { name: "Track name" });
        await expect(input).toHaveValue("First Song");
        await expect(input).toHaveCSS("text-transform", "none");
        await input.fill("New mixed Case");
        await expect(input).toHaveValue("New mixed Case");
        const checkbox = page.getByRole("checkbox", {
          name: "First Song · FLAC",
        });
        await expect(checkbox).toHaveAttribute("data-slot", "checkbox");
        await page.getByText("First Song · FLAC", { exact: true }).click();
        await expect(checkbox).toBeChecked();
        await checkbox.press("Space");
        await expect(checkbox).not.toBeChecked();
        await page.getByText("Automatic playback", { exact: true }).click();
        await expect(
          page.getByRole("switch", { name: "Automatic playback" }),
        ).toBeChecked();
        await page.getByText("Archive", { exact: true }).click();
        await expect(
          page.getByRole("radio", { name: "Archive" }),
        ).toBeChecked();
        const slider = page.getByRole("slider", { name: "Crossfade" });
        await expect(slider).toHaveValue("4");
        await slider.focus();
        await slider.press("ArrowRight");
        await expect(slider).toHaveValue("4.5");
        await expect(slider).toHaveAttribute("aria-valuetext", "4.5 seconds");
        const search = page.getByRole("searchbox", { name: "Search tracks" });
        await search.fill("costa");
        await expect(page.getByLabel("Applied query")).toHaveText("costa");
        await page.getByRole("button", { name: "Clear search" }).click();
        await expect(search).toHaveValue("");
        await expect(
          page.getByRole("textbox", { name: "Description" }),
        ).toHaveValue("Mixed Case stays as written.");
        const format = page.getByRole("combobox", { name: "Audio format" });
        await format.click();
        await page.getByRole("option", { name: "ALAC", exact: true }).click();
        await expect(format).toContainText("ALAC");
        const genre = page.getByRole("combobox", {
          name: "Genre",
          exact: true,
        });
        await genre.click();
        await page
          .getByRole("searchbox", { name: "Search genres" })
          .fill("jazz");
        await page.getByRole("option", { name: "Jazz", exact: true }).click();
        await expect(genre).toContainText("Jazz");
        const mode = page.getByRole("radiogroup", { name: "Listening mode" });
        await mode.getByRole("radio", { name: "Local", exact: true }).click();
        await expect(
          mode.getByRole("radio", { name: "Local", exact: true }),
        ).toBeChecked();
        const filter = page.getByRole("button", { name: "Ambient filter" });
        await filter.click();
        await expect(filter).toHaveAttribute("aria-pressed", "true");
        await expect(
          page.getByRole("textbox", { name: "Disabled field" }),
        ).toBeDisabled();
        await expect(
          page.getByRole("textbox", { name: "Read-only value" }),
        ).toHaveAttribute("readonly", "");
        await expect(
          page.getByRole("textbox", { name: "Invalid value" }),
        ).toHaveAttribute("aria-invalid", "true");
        const partial = page.getByRole("checkbox", {
          name: "Partial selection",
        });
        await expect(partial).toHaveAttribute("data-state", "indeterminate");
        await partial.click();
        await expect(partial).toBeChecked();
        for (const control of [input, search, format, genre, slider]) {
          await expect(control).toHaveCSS("height", touch ? "44px" : "40px");
        }
        for (const field of await page
          .locator('[data-slot="form-field"][data-layout="stacked"]')
          .all()) {
          const gap = await field.evaluate((el) => {
            const label = el.querySelector('[data-slot="form-field-label"]')!;
            return (
              label.nextElementSibling!.getBoundingClientRect().top -
              label.getBoundingClientRect().bottom
            );
          });
          expect(gap).toBeCloseTo(8, 1);
        }
        expect(
          await page
            .locator("body")
            .evaluate((el) => el.scrollWidth <= window.innerWidth),
        ).toBe(true);
        expect(apiRequests).toEqual([]);
      });
    });
  }
}
