import { expect, test } from "./fixtures";
for (const width of [1440, 768, 390]) {
  test.describe(`operational typography ${width}`, () => {
    test.use({ viewport: { width, height: 1000 } });
    test("keeps Tasks and System Health surfaces and their state readings without decorative icons", async ({
      openAdminPage,
      page,
    }) => {
      for (const [route, title, label, panel] of [
        ["/tasks", "Tasks", "Today", "Worker control"],
        ["/system", "System Health", "API p95", "Metric Streams"],
      ] as const) {
        await openAdminPage(route);
        const heading = page.getByRole("heading", {
          level: 1,
          name: title,
          exact: true,
        });
        await expect(heading).toBeVisible();
        await expect(heading.locator("..").locator("svg")).toHaveCount(0);
        const field = page.getByText(label, { exact: true }).locator("..");
        await expect(field).toHaveClass(/crate-form-field/);
        await expect(field.locator("svg")).toHaveCount(0);
        const reading = await field.evaluate((node) => {
          const labelNode = node.children[0]!.getBoundingClientRect();
          const value = node.children[1]!.getBoundingClientRect();
          return {
            gap: value.top - labelNode.bottom,
            value: node.children[1]!.textContent?.trim(),
          };
        });
        expect(reading.gap).toBe(8);
        expect(reading.value).toBeTruthy();
        const panelHeading = page.getByRole("heading", {
          level: 2,
          name: panel,
          exact: true,
        });
        await expect(panelHeading).toBeVisible();
        await expect(panelHeading.locator("..").locator("svg")).toHaveCount(0);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      }
    });
  });
}
