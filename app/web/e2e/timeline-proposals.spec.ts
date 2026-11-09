import {
  expect,
  test as base,
  type Locator,
  type Page,
} from "@playwright/test";
import { milestones } from "../src/data/engineering-timeline";

const PREVIEW = "/blog/timeline-proposals";
const proposals = [
  { id: "signal-track", label: "01 Signal track" },
  { id: "system-map", label: "02 System map" },
  { id: "field-notes", label: "03 Field notes" },
] as const;
type Proposal = (typeof proposals)[number]["id"];

const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      const capture = (error: Error) => errors.push(error.message);
      page.on("pageerror", capture);
      await use(errors);
      page.off("pageerror", capture);
      expect(
        errors,
        "The timeline must not raise browser JavaScript errors",
      ).toEqual([]);
    },
    { auto: true },
  ],
});

function component(page: Page, proposal: Proposal): Locator {
  return page.locator(`[data-timeline-proposal="${proposal}"]`);
}

async function selectProposal(
  page: Page,
  proposal: Proposal,
): Promise<Locator> {
  const selected = proposals.find((item) => item.id === proposal)!;
  await page.getByRole("tab", { name: selected.label, exact: true }).click();
  await expect(page.locator(`#panel-${proposal}`)).toBeVisible();
  return component(page, proposal);
}

async function expectSelectedProposal(
  page: Page,
  proposal: Proposal,
): Promise<void> {
  for (const item of proposals) {
    const tab = page.getByRole("tab", { name: item.label, exact: true });
    await expect(tab).toHaveAttribute(
      "aria-selected",
      String(item.id === proposal),
    );
    if (item.id === proposal) {
      await expect(page.locator(`#panel-${item.id}`)).toBeVisible();
    } else {
      await expect(page.locator(`#panel-${item.id}`)).toBeHidden();
    }
  }
}

async function expectMapMilestone(map: Locator, index: number): Promise<void> {
  const milestone = milestones[index]!;
  await expect(map).toHaveAttribute("data-selected-milestone", milestone.id);
  await expect(map.locator("[data-milestone-select]")).toHaveValue(
    String(index),
  );
  await expect(map.locator("[data-milestone-range]")).toHaveValue(
    String(index),
  );
  await expect(map.locator("[data-milestone-id]:visible h3")).toHaveText(
    milestone.title,
  );
  await expect(map.locator("[data-system-count]")).toHaveText(
    String(milestone.systems.length),
  );

  const preceding = milestones[index - 1]?.systems ?? [];
  for (const node of await map.locator("[data-system]").all()) {
    const system = (await node.getAttribute("data-system"))!;
    const state = milestone.systems.includes(system)
      ? preceding.includes(system)
        ? "present"
        : "added"
      : "later";
    await expect(node).toHaveAttribute("data-state", state);
  }
}

async function expectWithinViewport(elements: Locator): Promise<void> {
  const outside = await elements.evaluateAll((nodes) => {
    const width = document.documentElement.clientWidth;
    return nodes.flatMap((node) => {
      const rect = node.getBoundingClientRect();
      if (
        !rect.width ||
        !rect.height ||
        (rect.left >= -1 && rect.right <= width + 1)
      ) {
        return [];
      }
      return [
        {
          element: `${node.tagName}.${node.className}`,
          left: rect.left,
          right: rect.right,
          viewport: width,
        },
      ];
    });
  });
  expect(
    outside,
    "Visible timeline content must fit the viewport, even when overflow is clipped",
  ).toEqual([]);
}

async function expectStopInsideTrack(stop: Locator): Promise<void> {
  await expect
    .poll(
      () =>
        stop.evaluate((element) => {
          const viewport = element.closest("[data-track-viewport]")!;
          const bounds = viewport.getBoundingClientRect();
          const selected = element.getBoundingClientRect();
          return (
            selected.left >= bounds.left - 1 &&
            selected.right <= bounds.right + 1
          );
        }),
      {
        message:
          "The active milestone must be visible inside the timeline after a jump",
      },
    )
    .toBe(true);
}

test.beforeEach(async ({ page }) => {
  const response = await page.goto(PREVIEW);
  // Static Astro redirects use a meta refresh, so goto can finish before it runs.
  await expect(
    page.locator("[data-timeline-lab], [data-blog-home]"),
  ).toHaveCount(1);
  const redirected = (await page.locator("[data-blog-home]").count()) === 1;
  if (redirected) await expect(page).toHaveURL(/\/blog\/?$/);
  test.skip(
    redirected,
    "Timeline proposals are a development preview and redirect to the blog in production builds",
  );
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("tab", { name: proposals[0].label, exact: true }),
  ).toBeVisible();
});

test("all three proposals share the full chronology and tabs support keyboard navigation", async ({
  page,
}) => {
  expect(milestones.length).toBeGreaterThanOrEqual(30);
  for (const proposal of proposals) {
    await expect(
      component(page, proposal.id).locator("[data-milestone-id]"),
    ).toHaveCount(milestones.length);
  }
  await expectSelectedProposal(page, "signal-track");

  const firstTab = page.getByRole("tab", {
    name: proposals[0].label,
    exact: true,
  });
  await firstTab.focus();
  await firstTab.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: proposals[1].label, exact: true }),
  ).toBeFocused();
  await expectSelectedProposal(page, "system-map");

  await page.keyboard.press("End");
  await expect(
    page.getByRole("tab", { name: proposals[2].label, exact: true }),
  ).toBeFocused();
  await expectSelectedProposal(page, "field-notes");

  await page.keyboard.press("ArrowRight");
  await expect(firstTab).toBeFocused();
  await expectSelectedProposal(page, "signal-track");

  await page.keyboard.press("ArrowLeft");
  await expectSelectedProposal(page, "field-notes");
  await page.keyboard.press("Home");
  await expect(firstTab).toBeFocused();
  await expectSelectedProposal(page, "signal-track");
});

test("signal stops and period jumps use one timeline and reach both chronology boundaries", async ({
  page,
}) => {
  const track = component(page, "signal-track");
  const stops = track.locator("[data-track-stop]");
  const periods = track.locator("[data-track-period]");
  const previous = track.locator("[data-track-previous]");
  const next = track.locator("[data-track-next]");
  await expect(track.locator('input[type="range"]')).toHaveCount(0);
  await expect(track.locator("select")).toHaveCount(0);
  await expect(periods).toHaveCount(7);
  await expect(track.locator("[data-track-viewport]")).toHaveCount(1);
  await expect(previous).toBeDisabled();
  await expect(stops.first()).toHaveAttribute("aria-pressed", "true");

  await stops.nth(2).click();
  await expect(track.locator("[data-track-detail]:visible h3")).toHaveText(
    milestones[2]!.title,
  );
  await next.click();
  await expect(stops.nth(3)).toHaveAttribute("aria-pressed", "true");
  await previous.click();
  await expect(stops.nth(2)).toHaveAttribute("aria-pressed", "true");

  await stops.nth(2).focus();
  await stops.nth(2).press("End");
  await expect(stops.last()).toHaveAttribute("aria-pressed", "true");
  await expect(stops.last()).toBeFocused();
  await expect(track.locator("[data-track-detail]:visible h3")).toHaveText(
    milestones.at(-1)!.title,
  );
  await expect(next).toBeDisabled();
  await expectStopInsideTrack(stops.last());

  await stops.last().press("Home");
  await expect(previous).toBeDisabled();
  await expect(stops.first()).toBeFocused();
  await expectStopInsideTrack(stops.first());
  await stops.first().press("ArrowRight");
  await expect(stops.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(stops.nth(1)).toBeFocused();

  const eras = [...new Set(milestones.map((milestone) => milestone.era))];
  const era = eras[Math.floor(eras.length / 2)]!;
  const eraStart = milestones.findIndex((milestone) => milestone.era === era);
  const period = track.locator(`[data-track-period="${eraStart}"]`);
  await period.click();
  await expect(period).toHaveAttribute("aria-pressed", "true");
  await expect(stops.nth(eraStart)).toHaveAttribute("aria-pressed", "true");
  await expect(track.locator("[data-track-detail]:visible h3")).toHaveText(
    milestones[eraStart]!.title,
  );
  await expectStopInsideTrack(stops.nth(eraStart));
  await expect(
    track.locator("[data-track-stop][aria-pressed='true']"),
  ).toHaveCount(1);
  await expect(
    track.locator("[data-track-period][aria-pressed='true']"),
  ).toHaveCount(1);
  await period.press("End");
  await expect(periods.last()).toBeFocused();
  await expect(periods.last()).toHaveAttribute("aria-pressed", "true");
  await periods.last().press("Home");
  await expect(periods.first()).toBeFocused();
  await expect(stops.first()).toHaveAttribute("aria-pressed", "true");
});

test("the illuminated marker travels through intermediate positions and settles on the selected stop", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const track = component(page, "signal-track");
  const result = await track.evaluate(async (element) => {
    const marker = element.querySelector<HTMLElement>(
      "[data-track-indicator]",
    )!;
    const target =
      element.querySelectorAll<HTMLButtonElement>("[data-track-stop]")[5]!;
    const position = () =>
      new DOMMatrixReadOnly(getComputedStyle(marker).transform).m41;
    const start = position();
    target.click();
    const samples: number[] = [];
    await new Promise<void>((resolve) => {
      const sample = () => {
        samples.push(position());
        if ((element as HTMLElement).dataset.travelling)
          requestAnimationFrame(sample);
        else resolve();
      };
      requestAnimationFrame(sample);
    });
    return {
      start,
      end: position(),
      target: target.parentElement!.offsetLeft,
      samples,
    };
  });
  expect(result.end).toBeCloseTo(result.target, 0);
  expect(
    result.samples.filter((x) => x > result.start + 1 && x < result.target - 1)
      .length,
  ).toBeGreaterThan(3);
  await expect(track.locator("[data-track-stop]").nth(5)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expectStopInsideTrack(track.locator("[data-track-stop]").nth(5));

  // A new destination during travel must finish at the latest selection.
  await track.evaluate((element) => {
    (element.querySelector("[data-track-next]") as HTMLButtonElement).click();
    (
      element.querySelector("[data-track-previous]") as HTMLButtonElement
    ).click();
    (
      element.querySelector("[data-track-previous]") as HTMLButtonElement
    ).click();
  });
  await expect(track).not.toHaveAttribute("data-travelling", "true");
  await expect(track.locator("[data-track-stop]").nth(4)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const aligned = await track.evaluate((element) => {
    const marker = element
      .querySelector("[data-track-indicator]")!
      .getBoundingClientRect();
    const stop = element
      .querySelector('[data-track-stop][aria-pressed="true"]')!
      .getBoundingClientRect();
    return (
      Math.abs(marker.left - stop.left) < 1 &&
      Math.abs(marker.width - stop.width) < 1
    );
  });
  expect(aligned).toBe(true);
});

test("a mouse press during travel does not snap the light to the previous destination", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const track = component(page, "signal-track");
  const viewport = track.locator("[data-track-viewport]");
  await viewport.scrollIntoViewIfNeeded();
  const point = await track.locator("[data-track-stop]").nth(2).boundingBox();
  await page.mouse.move(point!.x + point!.width / 2, point!.y + 30);
  await track.evaluate((element) => {
    const viewport = element.querySelector<HTMLElement>(
      "[data-track-viewport]",
    )!;
    const marker = element.querySelector("[data-track-indicator]")!;
    const position = () =>
      new DOMMatrixReadOnly(getComputedStyle(marker).transform).m41;
    viewport.addEventListener(
      "pointerdown",
      () => {
        viewport.dataset.pressBefore = String(position());
      },
      { capture: true, once: true },
    );
    viewport.addEventListener(
      "pointerdown",
      () => {
        viewport.dataset.pressAfter = String(position());
      },
      { once: true },
    );
    (
      element.querySelectorAll("[data-track-stop]")[6] as HTMLButtonElement
    ).click();
  });
  await expect(track).toHaveAttribute("data-travelling", "true");
  await page.mouse.down();
  const delta = await viewport.evaluate((element) =>
    Math.abs(
      Number(element.dataset.pressBefore) - Number(element.dataset.pressAfter),
    ),
  );
  expect(delta).toBeLessThan(1);
  await page.mouse.up();
  await expect(track).not.toHaveAttribute("data-travelling", "true");
  await expectStopInsideTrack(
    track.locator('[data-track-stop][aria-pressed="true"]'),
  );
});

test("dragging the signal timeline pans without selecting a milestone on release", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const track = component(page, "signal-track");
  const viewport = track.locator("[data-track-viewport]");
  const stops = track.locator("[data-track-stop]");
  await stops.first().focus();
  await stops.first().press("Home");
  await viewport.scrollIntoViewIfNeeded();
  const before = await viewport.evaluate((element) => element.scrollLeft);
  const start = await viewport.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const candidates = [
      ...element.querySelectorAll<HTMLElement>("[data-track-stop]"),
    ]
      .filter((stop) => stop.getAttribute("aria-pressed") !== "true")
      .map((stop) => stop.getBoundingClientRect())
      .filter(
        (stop) => stop.left >= bounds.left + 180 && stop.right <= bounds.right,
      );
    const stop = candidates[Math.floor(candidates.length / 2)];
    return stop
      ? {
          x: stop.left + stop.width / 2,
          y: stop.top + Math.min(65, stop.height / 2),
        }
      : null;
  });
  expect(
    start,
    "There must be an unselected visible stop to begin a real pointer drag",
  ).not.toBeNull();
  await page.mouse.move(start!.x, start!.y);
  await page.mouse.down();
  await page.mouse.move(start!.x - 160, start!.y, { steps: 12 });
  await expect(viewport).toHaveAttribute("data-dragging", "true");
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(before + 100);
  await page.mouse.up();
  await expect(viewport).not.toHaveAttribute("data-dragging", "true");
  await expect(stops.first()).toHaveAttribute("aria-pressed", "true");
  await expect(track.locator("[data-track-detail]:visible h3")).toHaveText(
    milestones[0]!.title,
  );

  const visibleIndex = await viewport.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return [
      ...element.querySelectorAll<HTMLElement>("[data-track-stop]"),
    ].findIndex((stop) => {
      const rect = stop.getBoundingClientRect();
      return (
        stop.getAttribute("aria-pressed") !== "true" &&
        rect.left >= bounds.left &&
        rect.right <= bounds.right
      );
    });
  });
  expect(visibleIndex).toBeGreaterThan(0);
  await stops.nth(visibleIndex).click();
  await expect(stops.nth(visibleIndex)).toHaveAttribute("aria-pressed", "true");
});

test("the librarian draft opens and timeline controls work after returning", async ({
  page,
  request,
}) => {
  const librarian = milestones.find(
    (milestone) => milestone.id === "librarian",
  )!;
  expect(librarian.href).toBeTruthy();
  const response = await request.get(librarian.href!);
  expect(response.status()).toBe(200);

  const track = component(page, "signal-track");
  const link = track.locator(
    `[data-track-detail]:visible a[href="${librarian.href}?milestone=${librarian.id}"]`,
  );
  await expect(link).toBeVisible();
  await link.click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(librarian.href);
  expect(new URL(page.url()).searchParams.get("milestone")).toBe(librarian.id);
  await expect(page.locator("article h1")).toBeVisible();

  await page.goBack();
  await expect.poll(() => new URL(page.url()).pathname).toBe(PREVIEW);
  await expectSelectedProposal(page, "signal-track");
  const first = track.locator("[data-track-stop]").first();
  await first.focus();
  await first.press("Home");
  await track.locator("[data-track-next]").click();
  await expect(track.locator("[data-track-stop]").nth(1)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(track.locator("[data-track-detail]:visible h3")).toHaveText(
    milestones[1]!.title,
  );

  const map = await selectProposal(page, "system-map");
  await map.locator("[data-map-next]").click();
  await expectMapMilestone(map, 1);
});

for (const chapterNumber of [2, 3]) {
  test(`chapter ${chapterNumber} milestones open the corresponding draft`, async ({
    page,
    request,
  }) => {
    const chapter = milestones
      .map((milestone, index) => ({ milestone, index }))
      .filter(
        ({ milestone }) =>
          milestone.chapter === chapterNumber && milestone.href,
      );
    expect(chapter.length).toBeGreaterThan(0);
    const href = chapter[0]!.milestone.href!;
    expect(new Set(chapter.map(({ milestone }) => milestone.href)).size).toBe(
      1,
    );
    const response = await request.get(href);
    expect(response.status()).toBe(200);

    const track = component(page, "signal-track");
    for (const { milestone, index } of chapter) {
      expect(milestone.status).toBe("draft");
      await track.locator("[data-track-stop]").nth(index).click();
      const detail = track.locator("[data-track-detail]:visible");
      await expect(detail.locator("h3")).toHaveText(milestone.title);
      await expect(detail.locator(".track-read")).toHaveAttribute(
        "href",
        `${href}?milestone=${milestone.id}`,
      );
    }
    await track.locator("[data-track-detail]:visible .track-read").click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(href);
    await expect(page.locator("article h1")).toBeVisible();
  });
}

test("planned entries link historical evidence without offering placeholder articles", async ({
  page,
}) => {
  const index = milestones.findIndex(
    (milestone) => milestone.status === "planned" && !milestone.href,
  );
  expect(index).toBeGreaterThanOrEqual(0);
  const milestone = milestones[index]!;
  const track = component(page, "signal-track");
  await track.locator("[data-track-stop]").nth(index).click();
  const trackDetail = track.locator("[data-track-detail]:visible");
  await expect(trackDetail.locator(".track-planned")).toContainText(
    "Article not available",
  );
  await expect(trackDetail.locator(".track-read")).toHaveCount(0);
  await expect(trackDetail.locator(".track-source")).toHaveAttribute(
    "href",
    milestone.source,
  );

  const map = await selectProposal(page, "system-map");
  await map.locator("[data-milestone-select]").selectOption(String(index));
  const mapDetail = map.locator("[data-milestone-id]:visible");
  await expect(mapDetail.locator(".chapter-status")).toContainText("planned");
  await expect(mapDetail.locator(".chapter-link")).toHaveCount(0);
  await expect(mapDetail.locator(".source-link")).toHaveAttribute(
    "href",
    milestone.source,
  );

  const notes = await selectProposal(page, "field-notes");
  await notes.locator("[data-note-select]").nth(index).click();
  const note = notes.locator(`[data-milestone-id="${milestone.id}"]`);
  await expect(note.locator(".entry-status")).toContainText("Article planned");
  await expect(note.locator(".entry-article")).toHaveCount(0);
  await expect(note.locator(".entry-source")).toHaveAttribute(
    "href",
    milestone.source,
  );
});

test("the system map keeps range, picker, headline and capability states in sync", async ({
  page,
}) => {
  const map = await selectProposal(page, "system-map");
  await expectMapMilestone(map, 0);
  await expect(map.locator("[data-map-previous]")).toBeDisabled();

  const index = milestones.findIndex(
    (milestone, position) =>
      position > 0 &&
      milestone.systems.some(
        (system) => !milestones[position - 1]!.systems.includes(system),
      ),
  );
  expect(index).toBeGreaterThan(0);
  await map.locator("[data-milestone-select]").selectOption(String(index));
  await expectMapMilestone(map, index);
  await expect(
    map.locator('[data-system][data-state="added"]'),
  ).not.toHaveCount(0);

  const range = map.locator("[data-milestone-range]");
  await range.focus();
  await range.press("End");
  await expectMapMilestone(map, milestones.length - 1);
  await expect(map.locator("[data-map-next]")).toBeDisabled();
  await range.press("Home");
  await expectMapMilestone(map, 0);
  await map.locator("[data-map-next]").click();
  await expectMapMilestone(map, 1);
});

test("field notes select the last entry, step back and jump between eras", async ({
  page,
}) => {
  const notes = await selectProposal(page, "field-notes");
  await expect(notes).toHaveAttribute("data-enhanced", "");
  const selectors = notes.locator("[data-note-select]");
  await selectors.first().focus();
  await selectors.first().press("End");
  const last = milestones.at(-1)!;
  await expect(notes).toHaveAttribute("data-selected-milestone", last.id);
  await expect(selectors.last()).toBeFocused();
  await expect(selectors.last()).toHaveAttribute("aria-expanded", "true");
  await expect(
    notes.locator(`[data-milestone-id="${last.id}"] [data-note-detail]`),
  ).toBeVisible();
  await expect(notes.locator("[data-note-detail]:visible")).toHaveCount(1);
  await expect(notes.locator("[data-note-next]")).toBeDisabled();
  const lastEraIndex = milestones.findIndex(
    (milestone) => milestone.era === last.era,
  );
  await expect(
    notes.locator(`[data-era-index="${lastEraIndex}"]`),
  ).toHaveAttribute("aria-pressed", "true");

  await notes.locator("[data-note-previous]").click();
  await expect(notes).toHaveAttribute(
    "data-selected-milestone",
    milestones.at(-2)!.id,
  );
  await expect(selectors.last()).toHaveAttribute("aria-expanded", "false");

  const eras = [...new Set(milestones.map((milestone) => milestone.era))];
  const era = eras[Math.floor(eras.length / 2)]!;
  const firstInEra = milestones.find((milestone) => milestone.era === era)!;
  await notes
    .getByRole("button", { name: `Jump to ${era}`, exact: true })
    .click();
  await expect(notes).toHaveAttribute("data-selected-milestone", firstInEra.id);
  await expect(
    notes.locator(`[data-milestone-id="${firstInEra.id}"] .entry-change`),
  ).toContainText(firstInEra.change);

  await selectProposal(page, "system-map");
  await selectProposal(page, "field-notes");
  await expect(notes).toHaveAttribute("data-selected-milestone", firstInEra.id);
  await expect(notes.locator("[data-note-detail]:visible")).toHaveCount(1);
  await expect(
    notes.locator('[data-era-index][aria-pressed="true"]'),
  ).toHaveCount(1);
});

test("reduced motion keeps all three proposals selectable without running animations", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const track = component(page, "signal-track");
  await track.locator("[data-track-stop]").first().focus();
  await track.locator("[data-track-stop]").first().press("End");
  await expect(track.locator("[data-track-detail]:visible h3")).toHaveText(
    milestones.at(-1)!.title,
  );
  await expectStopInsideTrack(track.locator("[data-track-stop]").last());
  await expect(track).not.toHaveAttribute("data-travelling", "true");

  const map = await selectProposal(page, "system-map");
  await map
    .locator("[data-milestone-select]")
    .selectOption(String(milestones.length - 1));
  await expectMapMilestone(map, milestones.length - 1);

  const notes = await selectProposal(page, "field-notes");
  await notes.locator("[data-note-select]").first().focus();
  await notes.locator("[data-note-select]").first().press("End");
  await expect(notes).toHaveAttribute(
    "data-selected-milestone",
    milestones.at(-1)!.id,
  );
  for (const root of [track, map, notes]) {
    await expect
      .poll(() =>
        root.evaluate(
          (element) =>
            element
              .getAnimations({ subtree: true })
              .filter((animation) => animation.playState === "running").length,
        ),
      )
      .toBe(0);
  }
});

test("all proposals fit a 390px viewport with usable controls and no clipped layout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const important = {
    "signal-track":
      "[data-track-viewport], .track-details, [data-track-period], [data-track-previous], [data-track-next]",
    "system-map":
      ".map-content, .capability-map, .milestone-reader, .map-controls, .map-navigation, [data-milestone-select], [data-milestone-range], [data-system]",
    "field-notes":
      ".field-layout, .field-index, [data-note-entries], .entry-content, .field-eras, .entry-footer",
  };
  for (const proposal of proposals) {
    const root = await selectProposal(page, proposal.id);
    await expectWithinViewport(root);
    await expectWithinViewport(root.locator(important[proposal.id]));
  }

  const track = await selectProposal(page, "signal-track");
  await track.locator("[data-track-stop]").first().focus();
  await track.locator("[data-track-stop]").first().press("End");
  await expectStopInsideTrack(track.locator("[data-track-stop]").last());
  await expectWithinViewport(track.locator(important["signal-track"]));

  const map = await selectProposal(page, "system-map");
  await map
    .locator("[data-milestone-select]")
    .selectOption(String(milestones.length - 1));
  await expectMapMilestone(map, milestones.length - 1);
  await expectWithinViewport(map.locator(important["system-map"]));

  const notes = await selectProposal(page, "field-notes");
  await notes.locator("[data-note-select]").first().focus();
  await notes.locator("[data-note-select]").first().press("End");
  await expect(notes.locator("[data-note-detail]:visible")).toHaveCount(1);
  await expectWithinViewport(notes.locator(important["field-notes"]));

  for (const control of await notes
    .locator("[data-note-previous], [data-note-next]")
    .all()) {
    const box = await control.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
});
