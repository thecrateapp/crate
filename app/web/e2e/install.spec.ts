import { expect, test } from "@playwright/test";

const STEPS = [
  "Checking this machine",
  "Your music and Crate's data",
  "How you will reach Crate",
  "Integrations",
  "Your admin account",
  "Review",
  "Installing",
];

test("/install shows the command, the recording and all seven wizard screens", async ({
  page,
}) => {
  await page.goto("/install");

  await expect(page.locator("h1")).toHaveText("One line. Seven steps.");
  await expect(page.locator(".hero [data-copy]")).toHaveAttribute(
    "data-copy",
    "curl -fsSL https://cratemusic.app/install.sh | bash",
  );
  await expect(page.locator(".reqs li")).toHaveText([
    "Linux or macOS",
    "x86_64 or arm64",
    "Docker",
  ]);
  await expect(page.locator(".step h3")).toHaveText(STEPS);

  const screens = page.locator(".wterm");
  await expect(screens).toHaveCount(7);
  for (let i = 0; i < STEPS.length; i++) {
    await expect(screens.nth(i).locator(".k-title").first()).toHaveText(
      STEPS[i]!,
    );
    await expect(screens.nth(i).locator(".k-counter")).toHaveText(
      `STEP ${i + 1} OF 7`,
    );
  }
  await expect(page.locator("main")).not.toContainText("installer dev");
  await expect(screens.nth(2).locator(".cursor")).toContainText("Public HTTPS");
  await expect(screens.nth(5)).toContainText("Nothing has been written yet.");
  await expect(screens.nth(5).locator(".s-button-on")).toHaveText("  Yes  ");
  await expect(
    page.locator(`a[href="https://docs.cratemusic.app/start/quickstart"]`),
  ).toHaveCount(1);
  await expect(page.locator('a[href="/admin#telegram-agent"]')).toHaveCount(1);
});

test("the recording offers both formats and a poster, and every file is served", async ({
  page,
  request,
}) => {
  await page.goto("/install");
  const video = page.locator("[data-watch] video");
  await expect(video).toHaveAttribute("poster", "/install/install.webp");
  await expect(video).toHaveAttribute("preload", "none");
  expect(
    await video.evaluate(
      (element: HTMLVideoElement) => element.muted && element.loop,
    ),
  ).toBe(true);
  const sources = await video
    .locator("source")
    .evaluateAll((elements) =>
      elements.map((element) => [
        element.getAttribute("src"),
        element.getAttribute("type"),
      ]),
    );
  expect(sources).toEqual([
    ["/install/install.mp4", "video/mp4"],
    ["/install/install.webm", "video/webm"],
  ]);

  for (const [path, type] of [
    ...sources,
    ["/install/install.webp", "image/webp"],
  ]) {
    const response = await request.get(path!);
    expect(response.status(), path!).toBe(200);
    expect(response.headers()["content-type"]).toContain(type!);
  }
});

test("the top navigation and the home page lead to /install", async ({
  page,
}) => {
  await page.goto("/");
  const link = page.locator(".nav .links a[href='/install']");
  await expect(link).toHaveText("Install");
  await expect(link).toHaveClass(/is-accent/);
  await expect(page.locator("#get a[href='/install']")).toHaveCount(1);

  await link.click();
  await expect(page).toHaveURL(/\/install$/);
  await expect(page.locator("h1")).toBeVisible();
});

test("the step rail follows the scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/install");
  const steps = page.locator(".step");
  await page.locator("#step-3").evaluate((element) => {
    scrollTo(
      0,
      element.getBoundingClientRect().top + scrollY - innerHeight * 0.4,
    );
  });
  await expect(steps.nth(2)).toHaveClass(/is-active/);
  await expect(steps.nth(1)).toHaveClass(/is-done/);
  await expect(page.locator(".step.is-active")).toHaveCount(1);
});

test.describe("copy", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("copies the install command", async ({ page }) => {
    await page.goto("/install");
    const button = page.locator(".hero [data-copy]");
    await button.click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(await button.getAttribute("data-copy"));
    await expect(button.locator(".pill")).toHaveText("Copied");
  });
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("the menu has Install and the terminals scroll inside their window", async ({
    page,
  }) => {
    await page.goto("/install");
    await page.getByRole("button", { name: "Menu" }).click();
    const link = page
      .locator("#site-menu")
      .getByRole("link", { name: "Install" });
    await expect(link).toBeInViewport();
    await expect(link).toHaveClass(/is-accent/);
    await page.getByRole("button", { name: "Close" }).click();

    const widths = await page
      .locator(".wterm")
      .evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().right),
      );
    for (const right of widths) expect(right).toBeLessThanOrEqual(390);
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("shows every terminal line at once and leaves the recording paused", async ({
    page,
  }) => {
    await page.goto("/install");
    const screen = page.locator(".wterm").first();
    await screen.scrollIntoViewIfNeeded();
    const opacities = await screen
      .locator(".ln:not(.ctx)")
      .evaluateAll((lines) =>
        lines.map((line) => getComputedStyle(line).opacity),
      );
    expect(new Set(opacities)).toEqual(new Set(["1"]));
    await page.locator("[data-watch]").scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    expect(
      await page
        .locator("[data-watch] video")
        .evaluate((video: HTMLVideoElement) => video.paused),
    ).toBe(true);
    await expect(page.locator("[data-watch] [data-toggle]")).toHaveAttribute(
      "data-state",
      "play",
    );
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("every terminal line is readable and the video keeps native controls", async ({
    page,
  }) => {
    await page.goto("/install");
    const hidden = await page
      .locator(
        ".wterm .ln:not(.ctx), .flow li, .cmds > div, .ai-features li, [data-enter]",
      )
      .evaluateAll(
        (elements) =>
          elements.filter(
            (element) => getComputedStyle(element).opacity !== "1",
          ).length,
      );
    expect(hidden).toBe(0);
    await expect(page.locator("[data-watch] video")).toHaveAttribute(
      "controls",
      "",
    );
    await expect(page.locator("[data-watch] [data-toggle]")).toBeHidden();
  });
});
