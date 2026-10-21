import { expect, test } from "@playwright/test";
import catalogue from "./catalogue.json";
test("regrouping a component preserves its established English documentation URL", async ({
  page,
}) => {
  await page.goto("/?path=/docs/components-hairlinerow--docs");
  await expect(
    page.frameLocator("#storybook-preview-iframe").getByRole("region", {
      name: "Entry: HairlineList / HairlineRow",
      exact: true,
    }),
  ).toBeVisible();
});
test("components are grouped by their primary purpose in navigation and inventory", async ({
  page,
}) => {
  const index = await (await page.request.get("/index.json")).json();
  const titles = Object.values(index.entries).map(
    (e) => (e as { title: string }).title,
  );
  expect(titles).toContain("Components/Forms/FilterChip");
  expect(titles).toContain("Components/Feedback/StatusDot");
  expect(titles).toContain("Components/Data Display/MonoLabel");
  for (const entry of catalogue.entries.filter(
    (e) => e.coverage === "documented" && e.category !== "Foundations",
  )) {
    expect(index.entries[`${entry.storyId}--docs`].title).toContain(
      `Components/${entry.category}/`,
    );
  }
  await page.goto("/iframe.html?id=system-inventory--catalogue&viewMode=story");
  await expect(
    page.getByRole("columnheader", { name: "Category", exact: true }),
  ).toBeVisible();
});
test("documentation preserves shared badge typography instead of Markdown styles", async ({
  page,
}) => {
  await page.goto("/iframe.html?id=components-infobadge--docs&viewMode=docs");
  const badge = page
    .getByRole("region", {
      name: "Entry: InfoBadge / OfflineBadge",
      exact: true,
    })
    .locator(".crate-info-badge")
    .first();
  await expect(badge).toHaveCSS("font-family", /JetBrains/);
  await expect(badge).toHaveCSS("font-size", "12px");
  await expect(badge).toHaveCSS("height", "24px");
});
test("the catalogue is English and its chrome uses the Crate identity", async ({
  page,
}) => {
  await page.goto("/?path=/docs/system-introduction--docs");
  const content = page.frameLocator("#storybook-preview-iframe");
  await expect(
    content.getByRole("heading", {
      name: "Crate UI — Design System",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    content.getByRole("link", { name: "Foundations", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#storybook-sidebar-region")).toHaveCSS(
    "font-family",
    /Roboto/,
  );
  await expect(
    content.getByRole("heading", {
      name: "Crate UI — Design System",
      exact: true,
    }),
  ).toHaveCSS("font-family", /Bricolage Grotesque/);
  await expect(content.locator(".sbdocs-wrapper")).toHaveCSS(
    "background-color",
    "rgb(10, 10, 15)",
  );
  await content.getByRole("link", { name: "Foundations", exact: true }).click();
  await expect(page).toHaveURL(/path=\/docs\/system-foundations--docs/);
});
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => console.error("Page error:", e.message));
  page.on("requestfailed", (r) =>
    console.error("Request failed:", r.url(), r.failure()?.errorText),
  );
  page.on("response", (r) => {
    if (r.status() >= 400) console.error("HTTP", r.status(), r.url());
  });
});
test("foundation and inventory documentation use real tokens and explicit pending coverage", async ({
  page,
}) => {
  await page.goto("/iframe.html?id=system-foundations--colors&viewMode=story");
  await expect(
    page.getByRole("heading", { name: "Crate colors" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "--accent-action-hi", exact: true }),
  ).toBeVisible();
  await page.goto("/iframe.html?id=system-inventory--catalogue&viewMode=story");
  await expect(
    page.getByRole("table", { name: "Component inventory" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "MonoLabel", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Pending", { exact: true }).first(),
  ).toBeVisible();
});
test("foundation typography samples load the declared Crate font faces", async ({
  page,
}) => {
  await page.goto(
    "/iframe.html?id=system-foundations--typography&viewMode=story",
  );
  await expect(
    page.getByText("Roboto · body and controls", { exact: true }),
  ).toHaveCSS("font-family", /Roboto/);
  await expect(
    page.getByText("Bricolage Grotesque · headings and numerals", {
      exact: true,
    }),
  ).toHaveCSS("font-family", /Bricolage Grotesque/);
  await expect(
    page.getByText("JetBrains Mono · labels and metadata", { exact: true }),
  ).toHaveCSS("font-family", /JetBrains/);
});
for (const width of [390, 1200])
  test(`real label, status and numeral contracts at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(
      "/iframe.html?id=components-monolabel--base&viewMode=story",
    );
    const label = page.getByText("Your library", { exact: true });
    await expect(label).toHaveCSS("text-transform", "uppercase");
    await expect(label).toHaveCSS("font-weight", "400");
    expect(
      await label.evaluate((e) => getComputedStyle(e).fontFamily),
    ).toContain("JetBrains");
    await page.goto(
      "/iframe.html?id=components-statusdot--states&viewMode=story",
    );
    await expect(page.getByText("Available", { exact: true })).toBeVisible();
    await expect(page.locator(".crate-status-dot").first()).toHaveCSS(
      "width",
      "6px",
    );
    await page.goto(
      "/iframe.html?id=components-statnumber--base&viewMode=story",
    );
    const number = page.getByText("96", { exact: true });
    await expect(number).toBeVisible();
    expect(
      await number.evaluate((e) => getComputedStyle(e).fontFamily),
    ).toContain("Bricolage Grotesque");
  });
test("badge and filter stories retain geometry and keyboard behaviour", async ({
  page,
}) => {
  await page.goto("/iframe.html?id=components-infobadge--tones&viewMode=story");
  await expect(page.locator(".crate-info-badge")).toHaveCount(7);
  for (const badge of await page.locator(".crate-info-badge").all()) {
    await expect(badge).toHaveCSS("height", "24px");
    await expect(badge).toHaveCSS("font-size", "12px");
  }
  await page.goto(
    "/iframe.html?id=components-filterchip--interactive&viewMode=story",
  );
  const chip = page.getByRole("button", { name: "Available only" });
  await chip.focus();
  await chip.press("Space");
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await page.goto(
    "/iframe.html?id=components-segmentedcontrol--keyboard&viewMode=story",
  );
  const all = page.getByRole("radio", { name: "Entire library" });
  await all.focus();
  await all.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Local only" })).toBeChecked();
  await page.goto(
    "/iframe.html?id=components-genrepill--editing&viewMode=story",
  );
  await page.getByRole("button", { name: "Remove Ambient" }).click();
  await expect(page.getByRole("status")).toHaveText("Ambient removed");
});
test("HairlineRow is shown without CSS compensation and with active semantics", async ({
  page,
}) => {
  await page.goto(
    "/iframe.html?id=components-hairlinerow--active-without-index&viewMode=story",
  );
  const row = page.locator('[data-slot="hairline-row"]');
  await expect(row).toHaveAttribute("data-active", "true");
  await expect(row.locator('[data-slot="active-bar"]')).toHaveCSS(
    "width",
    "2px",
  );
  await expect(page.getByText("Active row", { exact: true })).toBeVisible();
});
test("the Storybook docs entry describes the reconciled HairlineRow contract", async ({
  page,
}) => {
  await page.goto("/iframe.html?id=components-hairlinerow--docs&viewMode=docs");
  await expect(
    page.getByRole("heading", {
      name: /HairlineList \/ HairlineRow/,
      level: 1,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(/The component owns 12 px horizontal padding/),
  ).toBeVisible();
});
test("all documented inventory links resolve and the manager opens the chosen contract", async ({
  page,
}) => {
  const index = await (await page.request.get("/index.json")).json();
  for (const entry of catalogue.entries.filter(
    (e) => e.coverage === "documented",
  )) {
    expect(index.entries[`${entry.storyId}--docs`]).toBeTruthy();
    await page.goto(`/iframe.html?id=${entry.storyId}--docs&viewMode=docs`);
    await expect(
      page.getByRole("region", { name: `Entry: ${entry.name}`, exact: true }),
    ).toBeVisible();
  }
  await page.goto("/?path=/docs/system-inventory--docs");
  const preview = page.frameLocator("#storybook-preview-iframe");
  await preview
    .getByRole("row")
    .filter({
      has: preview.getByRole("cell", { name: "MonoLabel", exact: true }),
    })
    .getByRole("link", { name: "Open entry" })
    .click();
  await expect(page).toHaveURL(/path=\/docs\/components-monolabel--docs/);
  await expect(
    preview.getByRole("region", { name: "Entry: MonoLabel", exact: true }),
  ).toBeVisible();
});
