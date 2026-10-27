import { expect, test, type Page } from "@playwright/test";

async function mountAll(page: Page, path: string) {
  await page.goto(path);
  const roots = page.locator("[data-viz]");
  const count = await roots.count();
  for (let i = 0; i < count; i++) {
    await roots.nth(i).scrollIntoViewIfNeeded();
    await expect(roots.nth(i)).toHaveAttribute("data-viz-ready", "");
  }
  return count;
}

test("every live visual on /listen mounts when it comes into view", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  expect(await mountAll(page, "/listen")).toBe(5);
  expect(errors).toEqual([]);
});

test("every live visual on /admin mounts when it comes into view", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  expect(await mountAll(page, "/admin")).toBe(9);
  expect(errors).toEqual([]);
});

test("the genre wheel explains where an inherited EQ comes from", async ({
  page,
}) => {
  await page.goto("/admin");
  const wheel = page.locator("[data-viz='genres']");
  await wheel.scrollIntoViewIfNeeded();
  await expect(wheel).toHaveAttribute("data-viz-ready", "");
  await wheel.getByRole("button", { name: "funk" }).click();

  await expect(wheel.locator("[data-walk-source]")).toHaveText(
    "inherited from soul",
  );
  await expect(wheel.locator("[data-walk-preset]")).toHaveText("jazz");
});

test("Listen points Jams and Decks at the roadmap on /developers, which keeps shipped Smart Mix work off it", async ({
  page,
}) => {
  await page.goto("/listen");
  const links = page.locator('a[href="/developers#working-on"]');
  await expect(links).toHaveCount(2);

  await links.first().click();
  await expect(page).toHaveURL(/\/developers#working-on$/);
  const roadmap = page.locator("#working-on");
  await expect(roadmap).toBeInViewport();
  await expect(roadmap.locator(".status-badge")).toHaveCount(2);
  await expect(roadmap).toContainText("Jams");
  await expect(roadmap).toContainText("VirtualDJ");
  expect(await roadmap.textContent()).not.toMatch(
    /smart mix|beatmatch|bass swap|automix/i,
  );
});

test("every live visual on /developers mounts and the terminal streams the response", async ({
  page,
}) => {
  expect(await mountAll(page, "/developers")).toBe(2);
  const terminal = page.locator("[data-viz='terminal']");
  await terminal.scrollIntoViewIfNeeded();
  await expect(terminal.locator("[data-term-status]")).toHaveClass(/is-on/, {
    timeout: 8000,
  });
});

test("architecture stories mount their visuals and derive the same id for both spellings", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await mountAll(page, "/architecture")).toBe(4);
  const ids = await page.locator(".uuid .rows .out").allTextContents();
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(1);
  expect(ids[0]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test("the home page shows four live pieces that link to their pages", async ({
  page,
}) => {
  await page.goto("/");
  const band = page.locator("[data-viz='inside']");
  await band.scrollIntoViewIfNeeded();
  await expect(band).toHaveAttribute("data-viz-ready", "");
  const hrefs = await band
    .locator("a")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(hrefs).toEqual([
    "/listen#01-play",
    "/listen#03-radio",
    "/listen#06-yours",
    "/admin#01-health",
  ]);
  for (const href of hrefs) {
    const [path, id] = href!.split("#");
    await page.goto(path!);
    await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
  }
});

test("the home page leads with Smart Mix and AI agents and links to their chapters", async ({
  page,
}) => {
  await page.goto("/");
  const leads = page.locator(".leads a");
  const hrefs = await leads.evaluateAll((links) =>
    links.map((link) => link.getAttribute("href")),
  );
  expect(hrefs).toEqual(["/listen#smart-mix", "/admin#mcp"]);
  await expect(leads.nth(1)).toContainText(/MCP/);
  await expect(leads.nth(1)).toContainText(/approves them in Admin/);
  for (const href of hrefs) {
    const [path, id] = href!.split("#");
    await page.goto(path!);
    await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
  }
});

async function scrollPast(
  element: import("@playwright/test").Locator,
  share: number,
) {
  await element.evaluate((node, s) => {
    const box = node.getBoundingClientRect();
    const from = scrollY + box.top - innerHeight;
    const to = scrollY + box.bottom;
    window.scrollTo(0, from + (to - from) * s);
  }, share);
}

test("the home Smart Mix teaser locks the beat and hands the lows over as it scrolls past", async ({
  page,
}) => {
  await page.goto("/");
  const mix = page.locator("[data-viz='inside-mix']");
  await mix.scrollIntoViewIfNeeded();
  await expect(mix).toHaveAttribute("data-viz-ready", "");

  await scrollPast(mix, 0.02);
  await expect(mix.locator("[data-ro='lows']")).toHaveText("A");
  await expect(mix.locator("[data-ro='gainB']")).toHaveText("−∞");
  await expect(mix.locator("[data-mx-stage='0']")).toHaveClass(/is-on/);

  await scrollPast(mix, 0.98);
  await expect(mix.locator("[data-ro='phase']")).toHaveText("locked");
  await expect(mix.locator("[data-ro='lows']")).toHaveText("B");
  await expect(mix.locator("[data-ro='gainA']")).toHaveText("−∞");
  await expect(mix.locator("[data-mx-stage='3']")).toHaveClass(/is-on/);
});

test("the home agent teaser waits for a person before Approve is pressed", async ({
  page,
}) => {
  await page.goto("/");
  const agent = page.locator("[data-viz='inside-agent']");
  await agent.scrollIntoViewIfNeeded();
  await expect(agent).toHaveAttribute("data-viz-ready", "");

  await scrollPast(agent, 0.05);
  await expect(agent).toHaveAttribute("data-stage", "idle");
  await expect(agent.locator(".ag-plan")).not.toHaveClass(/is-shown/);

  await scrollPast(agent, 0.98);
  await expect(agent).toHaveAttribute("data-stage", "pressed");
  await expect(agent.locator("[data-ag-status]")).toHaveText(
    "Approved by a person · applied · audited",
  );
});

test("the home teasers are decorative and leave the card links with short names", async ({
  page,
}) => {
  await page.goto("/");
  for (const id of ["inside-mix", "inside-agent"])
    await expect(page.locator(`[data-viz='${id}']`)).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  await expect(page.locator(".leads a").first()).toHaveAccessibleName(
    "Not a crossfade. A planned transition. Inside Smart Mix",
  );
  await expect(page.locator(".leads a").nth(1)).toHaveAccessibleName(
    "Let an agent look after the library. Agents in Admin",
  );
});

test("the Smart Mix chapter ships Beatmatch and Bass swap on Android and keeps VirtualDJ coming soon", async ({
  page,
}) => {
  await page.goto("/listen");
  const chapter = page.locator("#smart-mix");
  await expect(page.locator('.toc a[href="#smart-mix"]')).toHaveCount(1);
  await expect(
    chapter.locator("h4", { hasText: "Beatmatch + Bass swap" }),
  ).toHaveCount(1);
  await expect(chapter.locator(".mix")).toContainText(/Beatmatch \+ Bass swap/);

  const status = (name: string) =>
    chapter.locator(`[data-platform="${name}"] .status-badge`);
  await expect(chapter.locator("[data-platform]")).toHaveCount(4);
  await expect(status("Android")).toHaveText("Available");
  await expect(chapter.locator('[data-platform="Android"]')).toContainText(
    "Smart Mix, Beatmatch and Bass swap",
  );
  await expect(status("Web and desktop")).toHaveText("Available");
  await expect(status("iOS")).toHaveText("Planned");
  await expect(status("VirtualDJ")).toHaveText("In development");
  await expect(page.locator('[id="10-decks"] .status-badge')).toHaveText(
    "In development",
  );
  expect(await page.locator("main").textContent()).not.toMatch(/automix/i);
});

test("the Smart Mix transition plays forward as the page scrolls", async ({
  page,
}) => {
  await page.goto("/listen");
  const mix = page.locator("[data-viz='mix']");
  await mix.scrollIntoViewIfNeeded();
  await expect(mix).toHaveAttribute("data-viz-ready", "");
  const scrollTo = (share: number) =>
    mix.evaluate((element, s) => {
      const box = element.getBoundingClientRect();
      window.scrollTo(0, scrollY + box.top + (box.height - innerHeight) * s);
    }, share);

  await scrollTo(0.02);
  await expect(mix.locator("[data-stage='0']")).toHaveClass(/is-on/);
  await expect(mix.locator("[data-gain='b']")).toHaveText("0.00");

  await scrollTo(0.98);
  await expect(mix.locator("[data-stage='3']")).toHaveClass(/is-on/);
  await expect(mix.locator("[data-phase]")).toHaveText("locked");
  await expect(mix.locator("[data-gain='b']")).toHaveText("1.00");
  await expect(mix.locator("[data-lows]")).toHaveText("B");
});

test("the Telegram chat only approves after the last plan page", async ({
  page,
}) => {
  await page.goto("/admin");
  const chat = page.locator("[data-viz='agent']");
  await chat.scrollIntoViewIfNeeded();
  await expect(chat).toHaveAttribute("data-viz-ready", "");
  const approve = chat.locator(".key.approve");
  const decision = chat.locator(".msg.decision");
  const scrollTo = (share: number) =>
    chat.evaluate((element, s) => {
      const box = element.getBoundingClientRect();
      window.scrollTo(0, scrollY + box.top + (box.height - innerHeight) * s);
    }, share);

  await scrollTo(0.02);
  await expect(chat.locator(".msg").first()).toBeVisible();
  await expect(decision).toBeHidden();
  await expect(approve).not.toHaveClass(/is-pressed/);

  await scrollTo(0.62);
  await expect(chat.locator(".msg.page").first()).toBeVisible();
  await expect(approve).not.toHaveClass(/is-pressed/);

  await scrollTo(0.99);
  await expect(chat.locator(".msg.page")).toHaveCount(3);
  for (const page of await chat.locator(".msg.page").all())
    await expect(page).toBeVisible();
  await expect(approve).toHaveClass(/is-pressed/);
  await expect(decision).toBeVisible();
  await expect(chat.locator(".msg.alert")).toBeVisible();
});

for (const path of ["/", "/admin"]) {
  test(`${path} never names the engine behind the Telegram agent`, async ({
    page,
  }) => {
    await page.goto(path);
    expect(await page.content()).not.toMatch(/hermes|nous research/i);
  });
}

test("the Telegram bot copy links to the Telegram agent section", async ({
  page,
}) => {
  await page.goto("/admin");
  await expect(page.locator('a[href="#hermes"]')).toHaveCount(0);
  const link = page.locator('a[href="#telegram-agent"]');
  await expect(link).toHaveCount(1);
  await expect(page.locator("#telegram-agent h3")).toHaveText(
    "Crate Agent and Crate Operator, in Telegram",
  );
  await expect(
    page.locator(
      '#telegram-agent a[href="https://docs.cratemusic.app/operations/crate-agent"]',
    ),
  ).toHaveCount(1);
});

test("visuals load lazily instead of with the page", async ({ page }) => {
  await page.goto("/listen");

  await expect(page.locator("[data-viz='federation']")).not.toHaveAttribute(
    "data-viz-ready",
    "",
  );
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the equalizer and the Smart Mix transition show their final state", async ({
    page,
  }) => {
    await page.goto("/listen");
    const eq = page.locator("[data-viz='eq']");
    await eq.scrollIntoViewIfNeeded();
    await expect(eq).toHaveAttribute("data-viz-ready", "");
    await expect(eq.locator("[data-eq-progress]")).toHaveCSS(
      "transform",
      /matrix\(1, 0, 0, 1/,
    );

    const mix = page.locator("[data-viz='mix']");
    await mix.scrollIntoViewIfNeeded();
    await expect(mix).toHaveAttribute("data-viz-ready", "");
    await expect(mix.locator("[data-gain='a']")).toHaveText("0.71");
    await expect(mix.locator("[data-gain='b']")).toHaveText("0.71");
    await expect(mix.locator("[data-phase]")).toHaveText("locked");
    await expect(mix.locator("[data-tempo]")).toHaveText("124.0");
    await expect(mix.locator("[data-stage]")).toHaveCount(4);
    for (const stage of await mix.locator("[data-stage]").all())
      await expect(stage).toBeVisible();
  });

  test("the Telegram chat shows the whole approved conversation", async ({
    page,
  }) => {
    await page.goto("/admin");
    const chat = page.locator("[data-viz='agent']");
    await chat.scrollIntoViewIfNeeded();
    await expect(chat).toHaveAttribute("data-viz-ready", "");
    for (const message of await chat.locator(".msg").all())
      await expect(message).toBeVisible();
    await expect(chat.locator(".key.approve")).toHaveClass(/is-pressed/);
    await expect(chat.locator("[data-chat-status]")).toHaveText(
      "Approved in Telegram · queued · reported",
    );
  });
});
