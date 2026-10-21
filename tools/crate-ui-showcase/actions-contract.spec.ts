import { expect, test } from "@playwright/test";

for (const host of ["preview", "storybook"]) {
  for (const config of [
    { width: 390, coarse: false },
    { width: 390, coarse: true },
    { width: 1200, coarse: false },
    { width: 1200, coarse: true },
  ]) {
    const { width, coarse } = config;
    test.describe(`${host} ${width}px ${coarse ? "coarse" : "fine"}`, () => {
      test.use({ viewport: { width, height: 1000 }, hasTouch: coarse });
      test("actions preserve geometry, semantics and interactions", async ({
        page,
      }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => {
          errors.push(error.message);
          console.error(error.message);
        });
        await page.goto(
          host === "preview"
            ? "http://127.0.0.1:5186/review-1as-actions.html"
            : "/iframe.html?id=reviews-1as-actions--complete&viewMode=story",
        );
        for (const [region, caption] of [
          ["Text actions", "Button · text actions"],
          ["Compact icon controls", "IconButton · round controls"],
          ["Compatibility actions", "ActionIcon · compatibility"],
        ] as const) {
          await expect(
            page
              .getByRole("region", { name: region })
              .getByRole("group", { name: caption, exact: true }),
          ).toBeVisible();
          const gap = await page
            .getByRole("region", { name: region })
            .getByText(caption, { exact: true })
            .evaluate((element) => {
              const label =
                element.closest('[data-slot="form-field-label"]') ?? element;
              return (
                label.nextElementSibling!.getBoundingClientRect().top -
                label.getBoundingClientRect().bottom
              );
            });
          expect
            .soft(gap, `${caption}: actual caption-to-sample gap`)
            .toBeCloseTo(8, 1);
        }
        const duplicate = page.getByRole("button", {
          name: "Duplicate Costa de noche",
        });
        await expect(duplicate).toBeVisible();
        await expect(duplicate).toHaveCSS("width", "44px");
        await expect(duplicate).toHaveCSS("height", "44px");
        await expect(duplicate).toHaveCSS("border-width", "0px");
        await expect(duplicate).toHaveCSS("border-radius", "4px");
        await expect(duplicate.locator("svg")).toHaveCSS("width", "20px");
        const small = page.getByRole("button", {
          name: "Small control",
          exact: true,
        });
        await expect(small).toHaveCSS("width", coarse ? "44px" : "32px");
        await expect(small).toHaveCSS("height", coarse ? "44px" : "32px");
        await expect(
          page.getByRole("button", { name: "Compact", exact: true }),
        ).toHaveCSS("height", coarse ? "44px" : "24px");
        await expect(
          page.getByRole("button", { name: "Legacy card", exact: true }),
        ).toHaveCSS("height", coarse ? "44px" : "36px");
        const compact = page
          .getByRole("region", { name: "Compact icon controls" })
          .getByRole("button");
        const boxes = await compact.evaluateAll((elements) =>
          elements.map((el) => {
            const b = el.getBoundingClientRect();
            return { x: b.x, y: b.y, r: b.right, b: b.bottom };
          }),
        );
        for (let i = 1; i < boxes.length; i++) {
          const a = boxes[i - 1]!;
          const b = boxes[i]!;
          expect(a.r <= b.x || a.b <= b.y).toBe(true);
        }
        await expect(
          page.getByRole("button", { name: "Submit form" }),
        ).toHaveCSS("font-family", /Roboto/);
        await expect(
          page.getByRole("button", { name: "Submit form" }),
        ).toHaveCSS("font-size", "14px");
        await duplicate.focus();
        await expect(
          page.getByRole("tooltip", { name: "Duplicate", exact: true }),
        ).toBeVisible();
        await expect(duplicate).toHaveCSS("outline-width", "2px");
        await page.keyboard.press("Escape");
        await page.keyboard.press("Enter");
        await expect(page.getByRole("status")).toHaveText(
          "Playlist duplicated.",
        );
        await page
          .getByRole("button", { name: "Remove Marea", exact: true })
          .click();
        await expect(page.getByRole("status")).toHaveText("Track removed.");
        await page.getByRole("button", { name: "Save Costa de noche" }).click();
        await expect(
          page.getByRole("button", { name: "Save Costa de noche" }),
        ).toBeDisabled();
        await expect(
          page.getByRole("button", { name: "Save Costa de noche" }),
        ).toHaveAttribute("aria-busy", "true");
        await page
          .getByRole("group", { name: "Save Costa de noche", exact: true })
          .focus();
        await expect(
          page.getByRole("tooltip", { name: "Save", exact: true }),
        ).toBeVisible();
        await page.getByRole("button", { name: "Complete save" }).click();
        await expect(
          page.getByRole("button", { name: "Save Costa de noche" }),
        ).toBeEnabled();
        await page.getByRole("button", { name: "Follow artist" }).click();
        await expect(
          page.getByRole("button", { name: "Follow artist" }),
        ).toHaveAttribute("aria-pressed", "true");
        await page.emulateMedia({ reducedMotion: "reduce" });
        await expect(
          page.getByRole("button", { name: "Follow artist" }),
        ).toHaveCSS("animation-name", "none");
        await page.getByRole("button", { name: "Submit form" }).click();
        await expect(page.getByRole("status")).toHaveText("Form submitted.");
        await page
          .getByRole("link", { name: "Disabled text link" })
          .dispatchEvent("click");
        await page
          .getByRole("link", { name: "Disabled legacy link" })
          .dispatchEvent("click");
        await page
          .getByRole("link", { name: "Download Marea" })
          .dispatchEvent("click");
        expect(new URL(page.url()).hash).toBe("");
        await page.getByRole("button", { name: "Enable download" }).click();
        await expect(
          page.getByRole("link", { name: "Download Marea" }),
        ).not.toHaveAttribute("aria-disabled", "true");
        await page
          .getByRole("link", { name: "Preview Costa de noche" })
          .click();
        await expect(page).toHaveURL(/#preview-target$/);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        expect(errors).toEqual([]);
      });
    });
  }
}

test("action families have English catalogue documentation and coherent categories", async ({
  page,
}) => {
  const index = await (await page.request.get("/index.json")).json();
  for (const [id, category] of [
    ["button", "Actions"],
    ["iconbutton", "Actions"],
    ["actiongroup", "Actions"],
    ["actioniconbutton", "Compatibility"],
  ]) {
    expect(index.entries[`components-${id}--docs`].title).toContain(
      `Components/${category}/`,
    );
    await page.goto(`/iframe.html?id=components-${id}--docs&viewMode=docs`);
    await expect(page.getByRole("region", { name: /^Entry:/ })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Contract", exact: true }),
    ).toBeVisible();
  }
});
