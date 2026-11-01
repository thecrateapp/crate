import { expect, test, type Locator, type Page } from "@playwright/test";

const REVIEW = "/review-stack-map.html";

async function assertTargets(map: Locator) {
  const nodes = map.getByRole("button", { name: /^Inspect / });
  const boxes = await nodes.evaluateAll((elements) =>
    elements.map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { name: element.getAttribute("aria-label"), x, y, width, height };
    }),
  );
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.width, `${box.name} target width`).toBeGreaterThanOrEqual(44);
    expect(box.height, `${box.name} target height`).toBeGreaterThanOrEqual(44);
  }
  const overlaps: string[] = [];
  for (let index = 0; index < boxes.length; index++) {
    for (const other of boxes.slice(index + 1)) {
      const box = boxes[index]!;
      const width =
        Math.min(box.x + box.width, other.x + other.width) -
        Math.max(box.x, other.x);
      const height =
        Math.min(box.y + box.height, other.y + other.height) -
        Math.max(box.y, other.y);
      if (width > 1 && height > 1) overlaps.push(`${box.name} / ${other.name}`);
    }
  }
  expect(overlaps, "Service hit targets must not overlap").toEqual([]);
  const labels = await map
    .locator(".stack-map__node-label")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { name: element.textContent, x, y, width, height };
      }),
    );
  const labelOverlaps: string[] = [];
  for (let index = 0; index < labels.length; index++) {
    for (const other of labels.slice(index + 1)) {
      const label = labels[index]!;
      const width =
        Math.min(label.x + label.width, other.x + other.width) -
        Math.max(label.x, other.x);
      const height =
        Math.min(label.y + label.height, other.y + other.height) -
        Math.max(label.y, other.y);
      if (width > 1 && height > 1)
        labelOverlaps.push(`${label.name} / ${other.name}`);
    }
  }
  expect(
    labelOverlaps,
    "Service labels must remain separately readable",
  ).toEqual([]);
}

async function assertNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "The checkpoint must fit the viewport",
  ).toBe(true);
}

async function assertFieldGap(page: Page, name: string) {
  const control = page.getByRole("radiogroup", { name, exact: true });
  const field = page
    .locator('[data-slot="form-field"]')
    .filter({ has: control });
  const label = field.locator('[data-slot="form-field-label"]');
  const labelBox = await label.boundingBox();
  const controlBox = await control.boundingBox();
  expect(labelBox).not.toBeNull();
  expect(controlBox).not.toBeNull();
  expect(controlBox!.y - (labelBox!.y + labelBox!.height)).toBeCloseTo(8, 1);
}

for (const width of [1440, 390, 320]) {
  test(`Stack map has separate 44px service targets and no overflow at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1100 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(REVIEW);
    const map = page.getByRole("region", { name: "Stack topology" });
    await expect(map).toBeVisible();
    await expect(
      map.getByRole("button", { name: "Inspect API" }),
    ).toBeVisible();
    await assertFieldGap(page, "Snapshot sample");
    if (width < 880) {
      await assertFieldGap(page, "Deployment");
      await expect(
        map.getByRole("button", { name: "Inspect Grafana" }),
      ).toHaveCount(0);
    } else {
      await expect(
        map.getByRole("button", { name: "Inspect Grafana" }),
      ).toBeVisible();
    }
    await assertTargets(map);
    await assertNoHorizontalOverflow(page);
    if (width < 880) {
      const field = await map.locator(".stack-map__stage").boundingBox();
      const inspector = await map
        .getByRole("region", { name: "Service inspector" })
        .boundingBox();
      const legend = await map.locator(".stack-map__legend").boundingBox();
      const index = await map.locator(".stack-map__list").boundingBox();
      expect(inspector!.y).toBeGreaterThanOrEqual(field!.y + field!.height);
      expect(legend!.y).toBeGreaterThanOrEqual(
        inspector!.y + inspector!.height,
      );
      expect(index!.y).toBeGreaterThanOrEqual(legend!.y + legend!.height);
    }
    await page.screenshot({
      path: testInfo.outputPath(`stack-${width}.png`),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}

test("Stack map supports keyboard selection and related-service navigation on desktop", async ({
  page,
}) => {
  await page.goto(REVIEW);
  const map = page.getByRole("region", { name: "Stack topology" });
  const inspector = map.getByRole("region", { name: "Service inspector" });
  const postgres = map.getByRole("button", { name: "Inspect PostgreSQL" });
  await postgres.focus();
  await page.keyboard.press("Enter");
  await expect(postgres).toHaveAttribute("aria-pressed", "true");
  await expect(
    inspector.getByRole("heading", { name: "PostgreSQL", exact: true }),
  ).toBeVisible();
  await inspector
    .getByRole("button", { name: "Focus API", exact: true })
    .click();
  await expect(
    map.getByRole("button", { name: "Inspect API" }),
  ).toHaveAttribute("aria-pressed", "true");
  const redis = map.getByRole("button", {
    name: "Inspect Redis cache",
    exact: true,
  });
  await redis.focus();
  await page.keyboard.press("Space");
  await expect(redis).toHaveAttribute("aria-pressed", "true");
});

test("Mobile deployment selector and relations can move between both stacks", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto(REVIEW);
  const map = page.getByRole("region", { name: "Stack topology" });
  const deployment = map.getByRole("radiogroup", {
    name: "Deployment",
    exact: true,
  });
  await deployment
    .getByRole("radio", { name: "Observability", exact: true })
    .click();
  await expect(
    map.getByRole("button", { name: "Inspect Prometheus" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(map.getByRole("button", { name: "Inspect API" })).toHaveCount(0);
  await assertTargets(map);
  await map.getByRole("button", { name: "Inspect PG exporter" }).click();
  await map
    .getByRole("region", { name: "Service inspector" })
    .getByRole("button", { name: "Focus PostgreSQL", exact: true })
    .click();
  const postgres = map.getByRole("button", { name: "Inspect PostgreSQL" });
  await expect(postgres).toHaveAttribute("aria-pressed", "true");
  await expect(postgres).toBeFocused();
  await expect(
    deployment.getByRole("radio", { name: "Application", exact: true }),
  ).toBeChecked();
  await assertNoHorizontalOverflow(page);
});

test("All snapshot samples preserve observed zero and expose unavailable metrics without requests", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    if (
      ["fetch", "xhr", "eventsource", "websocket"].includes(
        request.resourceType(),
      )
    ) {
      requests.push(request.url());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(REVIEW);
  const map = page.getByRole("region", { name: "Stack topology" });
  const samples = page.getByRole("radiogroup", {
    name: "Snapshot sample",
    exact: true,
  });
  const inspector = map.getByRole("region", { name: "Service inspector" });
  await map
    .getByRole("button", { name: "Inspect Listen", exact: true })
    .click();
  await expect(inspector).toContainText("0.0%");
  await samples.getByRole("radio", { name: "Degraded", exact: true }).click();
  await map.getByRole("button", { name: "Inspect PostgreSQL" }).click();
  await expect(inspector).toContainText("Healthcheck failed");
  await expect(inspector).toContainText("94.6%");
  for (const sample of ["Stale", "Unavailable"]) {
    await samples.getByRole("radio", { name: sample, exact: true }).click();
    await expect(inspector).toContainText("n/a");
    await expect(inspector).not.toContainText("94.6%");
    await expect(inspector).not.toContainText("7420 MiB");
    await expect(inspector).not.toContainText("Healthcheck passed");
    await assertNoHorizontalOverflow(page);
  }
  await samples.getByRole("radio", { name: "Observed", exact: true }).click();
  await expect(inspector).toContainText("16.1%");
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test("Reduced motion disables graph transitions while keeping selection usable", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(REVIEW);
  const map = page.getByRole("region", { name: "Stack topology" });
  await expect(map).toHaveAttribute("data-motion", "off");
  const postgres = map.getByRole("button", { name: "Inspect PostgreSQL" });
  await expect(postgres).toHaveCSS("transition-duration", "0s");
  await postgres.click();
  await expect(postgres).toHaveAttribute("aria-pressed", "true");
});

test("Recorded live activity moves along declared links only when motion is allowed", async ({
  page,
}) => {
  await page.goto(REVIEW);
  const map = page.getByRole("region", { name: "Stack topology" });
  await assertFieldGap(page, "Activity sample");
  await expect(map.locator("[data-live-status]")).toHaveAttribute(
    "data-live-status",
    "live",
  );
  await expect(map.locator(".stack-map__field-live")).toContainText("req/min");
  await expect
    .poll(() => map.locator(".stack-map__pulse").count(), { timeout: 7000 })
    .toBeGreaterThan(0);
  await expect(map.locator(".stack-map__pulse")).toHaveCount(0, {
    timeout: 7000,
  });
});

test("Reduced motion keeps live readings but never animates pulses", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(REVIEW);
  const map = page.getByRole("region", { name: "Stack topology" });
  await expect(map.locator(".stack-map__field-live")).toContainText("req/min");
  await page.waitForTimeout(6000);
  await expect(map.locator(".stack-map__pulse")).toHaveCount(0);
  await expect(map.locator(".stack-map__level").first()).toBeVisible();
});

test("Paused and unavailable activity samples never present stale data as live", async ({
  page,
}) => {
  await page.goto(REVIEW);
  const map = page.getByRole("region", { name: "Stack topology" });
  const samples = page.getByRole("radiogroup", {
    name: "Activity sample",
    exact: true,
  });
  await samples.getByRole("radio", { name: "Paused", exact: true }).click();
  await expect(map.locator("[data-live-status]")).toHaveAttribute(
    "data-live-status",
    "paused",
  );
  await page.waitForTimeout(1500);
  await expect(map.locator(".stack-map__pulse")).toHaveCount(0);
  await samples
    .getByRole("radio", { name: "Unavailable", exact: true })
    .click();
  await expect(map.locator("[data-live-status]")).toHaveText(
    "Live data unavailable",
  );
  await expect(map.locator(".stack-map__field-live")).toContainText(
    "— req/min",
  );
});
