import { expect, test } from "@playwright/test";

const expected = [
  ["bricolage-roboto", "Bricolage Grotesque", "Roboto"],
  ["bricolage-plex", "Bricolage Grotesque", "Review IBM Plex Sans"],
  ["tektur-golos", "Review Tektur", "Review Golos Text"],
  ["chakra-plex", "Review Chakra Petch", "Review IBM Plex Sans"],
  ["oxanium-hanken", "Review Oxanium", "Review Hanken Grotesk"],
  ["unbounded-onest", "Review Unbounded", "Review Onest"],
  ["current", "Bricolage Grotesque", "Poppins"],
  ["hubot-mona", "Review Hubot Sans", "Review Mona Sans"],
  ["saira", "Review Saira", "Review Saira"],
  ["anybody-spline", "Review Anybody", "Review Spline Sans"],
] as const;

for (const [host, url] of [
  [
    "storybook",
    "/iframe.html?id=reviews-1be-font-pairings--complete&viewMode=story",
  ],
  [
    "standalone",
    "http://127.0.0.1:5186/review-1be-font-pairings.html?pairing=all",
  ],
])
  for (const width of [360, 390, 1440]) {
    test(`${host} actual fonts and local controls at ${width}px`, async ({
      page,
    }) => {
      const apiRequests: string[] = [];
      const remoteRequests: string[] = [];
      page.on("request", (request) => {
        const requestUrl = new URL(request.url());
        if (requestUrl.pathname.startsWith("/api/"))
          apiRequests.push(request.url());
        if (
          /^https?:$/.test(requestUrl.protocol) &&
          !["127.0.0.1", "localhost"].includes(requestUrl.hostname)
        )
          remoteRequests.push(request.url());
      });
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(url!);
      const comparison = page.getByTestId("font-comparison");
      await expect(comparison).toHaveAttribute("data-fonts", "ready", {
        timeout: 30000,
      });
      await expect(page.locator("[data-font-pairing]")).toHaveCount(
        expected.length,
      );
      const metrics: string[][] = [];
      const monoMetrics: string[][] = [];
      for (const [id, display, body] of expected) {
        const sample = page.locator(`[data-font-pairing="${id}"]`);
        const heading = sample.getByRole("heading", {
          name: "The Lovecraft Sextet",
          exact: true,
        });
        const family = await heading.evaluate(
          (el) => getComputedStyle(el).fontFamily,
        );
        expect(family, id).toContain(display);
        expect(
          await sample
            .getByRole("textbox")
            .evaluate((el) => getComputedStyle(el).fontFamily),
          id,
        ).toContain(body);
        expect(
          await sample
            .locator(".crate-entity-title")
            .first()
            .evaluate((el) => getComputedStyle(el).fontFamily),
          id,
        ).toContain(body);
        const mono = sample.getByText("JetBrains Mono · 83 BPM · 8A · 4:57", {
          exact: true,
        });
        expect(
          await mono.evaluate((el) => getComputedStyle(el).fontFamily),
          id,
        ).toContain("JetBrains Mono");
        monoMetrics.push(
          await mono.evaluate((el) => {
            const css = getComputedStyle(el);
            return [
              css.fontFamily,
              css.fontSize,
              css.fontWeight,
              css.lineHeight,
              css.letterSpacing,
              css.textTransform,
            ];
          }),
        );
        metrics.push(
          await heading.evaluate((el) => {
            const css = getComputedStyle(el);
            return [css.fontSize, css.fontWeight, css.letterSpacing, css.color];
          }),
        );
        const group = sample.getByRole("group", {
          name: "Track row",
          exact: true,
        });
        expect(
          await group.evaluate(
            (el) =>
              el.getBoundingClientRect().top -
              document
                .getElementById(el.getAttribute("aria-labelledby")!)!
                .getBoundingClientRect().bottom,
          ),
        ).toBe(8);
        expect(
          await sample
            .getByRole("textbox")
            .evaluate((el) => el.scrollWidth <= el.clientWidth),
        ).toBe(true);
      }
      metrics.forEach((metric) => expect(metric).toEqual(metrics[0]));
      monoMetrics.forEach((metric) => expect(metric).toEqual(monoMetrics[0]));
      const loaded = await page.evaluate(() =>
        [
          "Roboto",
          "Review Hubot Sans",
          "Review Mona Sans",
          "Review Saira",
          "Review Anybody",
          "Review Spline Sans",
          "Review Tektur",
          "Review Golos Text",
          "Review Chakra Petch",
          "Review IBM Plex Sans",
          "Review Oxanium",
          "Review Hanken Grotesk",
          "Review Unbounded",
          "Review Onest",
        ].every((family) =>
          document.fonts.check(`400 16px "${family}"`, "Björk L’été œ ẞ"),
        ),
      );
      expect(loaded).toBe(true);
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(() =>
          ["Bricolage Grotesque", "Roboto", "JetBrains Mono"].every((family) =>
            [...document.fonts].some(
              (face) =>
                face.family.replaceAll('"', "") === family &&
                face.status === "loaded",
            ),
          ),
        ),
      ).toBe(true);
      expect(
        await page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue("--font-brand")
            .trim()
            .replaceAll('"', ""),
        ),
      ).toBe("Roboto");
      expect(
        await page
          .getByRole("heading", {
            name: "Comparativa tipográfica",
            exact: true,
          })
          .evaluate((el) => getComputedStyle(el).fontFamily),
      ).toContain("Bricolage Grotesque");
      await page
        .getByRole("textbox")
        .first()
        .fill("Björk · L’été à Montréal · Für immer");
      for (const input of await page.getByRole("textbox").all())
        await expect(input).toHaveValue("Björk · L’été à Montréal · Für immer");
      await page
        .getByRole("radio", { name: "Hubot + Mona", exact: true })
        .click();
      await expect(page.locator("[data-font-pairing]")).toHaveCount(1);
      await expect(
        page.locator('[data-font-pairing="hubot-mona"]'),
      ).toBeVisible();
      await page.getByRole("button", { name: "Play all", exact: true }).click();
      await expect(page.locator("output")).toHaveText(
        "Play all · ejemplo local",
      );
      await page.getByRole("radio", { name: "Todas", exact: true }).click();
      await expect(page.locator("[data-font-pairing]")).toHaveCount(
        expected.length,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.getByRole("radio", { name: "Nuevas", exact: true }).click();
      await expect(page.locator("[data-font-pairing]")).toHaveCount(5);
      await expect(
        page.locator('[data-font-pairing="hubot-mona"]'),
      ).toHaveCount(0);
      for (const name of [
        "Grotesque + Plex",
        "Tektur + Golos",
        "Chakra + Plex",
        "Oxanium + Hanken",
        "Unbounded + Onest",
      ]) {
        await page.getByRole("radio", { name, exact: true }).click();
        await expect(page.locator("[data-font-pairing]")).toHaveCount(1);
        await expect(
          page.getByRole("article", { name, exact: true }),
        ).toBeVisible();
      }
      expect(apiRequests).toEqual([]);
      expect(remoteRequests).toEqual([]);
    });
  }

test("shows a clear load failure instead of presenting a fallback as a candidate font", async ({
  page,
}) => {
  await page.route(/\/assets\/font-pairing\/.*\.woff2/, (route) =>
    route.abort(),
  );
  await page.goto("http://127.0.0.1:5186/review-1be-font-pairings.html");
  await expect(page.getByTestId("font-comparison")).toHaveAttribute(
    "data-fonts",
    "error",
  );
  await expect(
    page.getByText(
      "No se han podido cargar las fuentes de prueba. Recarga el preview.",
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--font-brand")
        .trim()
        .replaceAll('"', ""),
    ),
  ).toBe("Roboto");
});
