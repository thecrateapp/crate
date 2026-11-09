import { expect, test } from "@playwright/test";

test("milestone controls have consistent directional SVGs and usable focus and touch targets", async ({
  page,
}) => {
  await page.goto("/blog");
  const disclosure = page.locator("#development-timeline summary");
  await disclosure.focus();
  await disclosure.press("Enter");
  const track = page.locator('[data-timeline-proposal="signal-track"]');
  const previous = track.getByRole("button", {
    name: "Previous milestone",
    exact: true,
  });
  const next = track.getByRole("button", {
    name: "Next milestone",
    exact: true,
  });
  await expect(previous).toBeDisabled();
  for (const [button, direction] of [
    [previous, "arrow-left"],
    [next, "arrow-right"],
  ] as const) {
    const icon = button.locator("svg");
    await expect(icon).toHaveAttribute("data-blog-icon", direction);
    await expect(icon).toHaveAttribute("aria-hidden", "true");
    await expect(icon).toHaveAttribute("focusable", "false");
    const box = await button.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect((await icon.boundingBox())!.width).toBe(18);
  }
  // Tab through the periods to Next; keyboard navigation must show its focus ring.
  const periodCount = await track.locator("[data-track-period]").count();
  for (let index = 0; index <= periodCount; index++) {
    await page.keyboard.press("Tab");
  }
  await expect(next).toBeFocused();
  expect(
    await next.evaluate((node) => getComputedStyle(node).outlineStyle),
  ).not.toBe("none");
  await next.press("Enter");
  await expect(previous).toBeEnabled();
  const activePeriod = track.locator(
    '[data-track-period][aria-pressed="true"]',
  );
  const activeColor = await activePeriod.evaluate(
    (node) => getComputedStyle(node).borderTopColor,
  );
  await activePeriod.hover();
  await expect
    .poll(() =>
      activePeriod.evaluate((node) => getComputedStyle(node).borderTopColor),
    )
    .toBe(activeColor);
  const source = track.locator("[data-track-detail]:visible .track-source");
  // The selected milestone and optional article link precede the source link.
  for (let index = 0; index < 3; index++) {
    await page.keyboard.press("Tab");
    if (await source.evaluate((node) => node === document.activeElement)) break;
  }
  await expect(source).toBeFocused();
  expect(
    await source.evaluate((node) => getComputedStyle(node).outlineStyle),
  ).not.toBe("none");
  await expect(source.locator("svg")).toHaveAttribute(
    "data-blog-icon",
    "github",
  );
  // The next milestone may have no published article yet. The first one does.
  await previous.click();
  await expect(
    track.locator("[data-track-detail]:visible .track-read svg"),
  ).toHaveAttribute("data-blog-icon", "arrow-right");
});

test("post disclosure and article links keep semantic directions without adding focus stops", async ({
  page,
  request,
}) => {
  const second = await request.get("/blog/filesystem-to-indexed-catalogue");
  expect([200, 404]).toContain(second.status());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/blog/crate-started-as-a-librarian");
  const disclosure = page.locator("[data-series-browser]");
  const summary = disclosure.locator("summary");
  await expect(summary.locator("svg")).toHaveAttribute(
    "data-blog-icon",
    "chevron-down",
  );
  await summary.focus();
  await summary.press("Enter");
  await expect(disclosure).toHaveAttribute("open", "");
  const rotation = await summary
    .locator(".browser-toggle")
    .evaluate(
      (node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).a,
    );
  expect(rotation).toBeCloseTo(-1);
  await expect(
    disclosure.locator("[data-track-detail]:visible .track-read svg"),
  ).toHaveAttribute("data-blog-icon", "arrow-down");
  if (second.status() === 200) {
    await expect(page.locator("[data-next-post] svg")).toHaveAttribute(
      "data-blog-icon",
      "arrow-right",
    );
  } else {
    await expect(page.locator("[data-next-post]")).toHaveCount(0);
  }
  for (const icon of await page.locator("[data-related-posts] svg").all()) {
    await expect(icon).toHaveAttribute("data-blog-icon", "arrow-right");
    expect((await icon.boundingBox())!.width).toBe(16);
  }
  await expect(page.locator('[data-blog-icon][tabindex="0"]')).toHaveCount(0);
  expect((await page.request.get("/licenses/solar-icons.txt")).status()).toBe(
    200,
  );
  await expect(
    page.locator('a[href="/licenses/solar-icons.txt"]'),
  ).toContainText("480 Design");
});

test("comparison controls retain SVGs and expanded chevrons after state changes", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const response = await page.goto("/blog/timeline-proposals?view=system-map");
  // Static Astro redirects use a meta refresh, so goto can finish before it runs.
  await expect(
    page.locator("[data-timeline-lab], [data-blog-home]"),
  ).toHaveCount(1);
  const redirected = (await page.locator("[data-blog-home]").count()) === 1;
  if (redirected) await expect(page).toHaveURL(/\/blog\/?$/);
  test.skip(
    redirected,
    "Timeline proposals are only available in development.",
  );
  expect(response?.status()).toBe(200);
  const map = page.locator('[data-timeline-proposal="system-map"]');
  await expect(map.locator("[data-map-previous] svg")).toHaveAttribute(
    "data-blog-icon",
    "arrow-left",
  );
  await expect(map.locator("[data-map-next] svg")).toHaveAttribute(
    "data-blog-icon",
    "arrow-right",
  );
  await page.getByRole("tab", { name: "03 Field notes", exact: true }).click();
  const notes = page.locator('[data-timeline-proposal="field-notes"]');
  await expect(notes.locator("[data-note-previous] svg")).toHaveAttribute(
    "data-blog-icon",
    "arrow-up",
  );
  await expect(notes.locator("[data-note-next] svg")).toHaveAttribute(
    "data-blog-icon",
    "arrow-down",
  );
  const second = notes.locator("[data-note-select]").nth(1);
  await second.click();
  await expect(second).toHaveAttribute("aria-expanded", "true");
  await expect(second.locator("svg")).toHaveAttribute(
    "data-blog-icon",
    "chevron-down",
  );
  expect(
    await second
      .locator(".entry-toggle")
      .evaluate((node) => getComputedStyle(node).transitionDuration),
  ).toBe("0s");
});
