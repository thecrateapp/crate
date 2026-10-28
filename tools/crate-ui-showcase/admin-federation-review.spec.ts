import { expect, test } from "@playwright/test";

for (const width of [1440, 768, 390]) {
  test(`A5 Federation story renders at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    const unexpectedRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/") || url.port === "5174")
        unexpectedRequests.push(request.url());
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(
      "/iframe.html?id=reviews-admin-a5-federation--complete&viewMode=story",
    );
    await expect(
      page.getByRole("heading", { name: "Federation", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("Crate Review Node")).toBeVisible();
    await page.getByRole("tab", { name: "Peers" }).click();
    const inputWidths = await page
      .locator('input[aria-label="Probe URL"], input[aria-label="Pairing URL"]')
      .evaluateAll((inputs) =>
        inputs.map((input) => input.getBoundingClientRect().width),
      );
    expect(inputWidths).toHaveLength(2);
    const [probeWidth, pairingWidth] = inputWidths;
    expect(probeWidth).toBeDefined();
    expect(pairingWidth).toBeDefined();
    expect(probeWidth).toBeCloseTo(pairingWidth ?? 0, 1);
    await page.getByRole("tab", { name: "Audit" }).click();
    await expect(page.getByText("stream_ticket_issued")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    expect(unexpectedRequests).toEqual([]);
  });
}
