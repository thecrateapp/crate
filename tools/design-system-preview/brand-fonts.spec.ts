import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  test(`Admin uses the shared display, body and Mono faces at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/admin-dashboard-demo.html");
    const admin = page.getByRole("region", {
      name: "Página real de Admin",
      exact: true,
    });
    await expect(
      admin.getByRole("heading", { name: "Dashboard", exact: true }),
    ).toHaveCSS("font-family", /Bricolage Grotesque/);
    await expect(
      admin.getByRole("button", { name: "Refresh", exact: true }),
    ).toHaveCSS("font-family", /IBM Plex Sans/);
    await expect(admin.getByText("Current report", { exact: true })).toHaveCSS(
      "font-family",
      /JetBrains Mono/,
    );
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(() =>
        ["Bricolage Grotesque", "IBM Plex Sans", "JetBrains Mono"].every(
          (family) =>
            [...document.fonts].some(
              (face) =>
                face.family.replaceAll('"', "") === family &&
                face.status === "loaded",
            ),
        ),
      ),
    ).toBe(true);
  });
}
