import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
for (const width of [1440, 390]) {
  test.describe(`track/media ${width}`, () => {
    test.use({
      viewport: { width, height: 1000 },
      isMobile: width === 390,
      hasTouch: width === 390,
    });
    test("1S keeps row geometry, keyboard actions and shared media targets", async ({
      page,
    }, info) => {
      const errors: string[] = [];
      const requests: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (request.url().includes("/api/")) requests.push(request.url());
      });
      await page.addInitScript(() => {
        const writes: string[] = [];
        Reflect.set(window, "__trackWrites", writes);
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          writes.push(key);
          return original.call(this, key, value);
        };
      });
      await page.goto("/#pistas");
      const section = page.getByRole("region", {
        name: "Checkpoint 1S, Pistas y portadas",
      });
      await expect(section).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await section.scrollIntoViewIfNeeded();
      const rows = section.getByRole("figure", { name: "Filas de Listen" });
      const first = rows.getByRole("group", {
        name: "La luz entre las hojas",
        exact: true,
      });
      const second = rows.getByRole("group", {
        name: "Todo lo que queda al volver a casa",
        exact: true,
      });
      const third = rows.getByRole("group", {
        name: "El rumor del agua",
        exact: true,
      });
      await expect(first).toHaveAttribute("aria-current", "true");
      await expect(first.locator(".crate-track-title")).toHaveCSS(
        "font-size",
        "14px",
      );
      await expect(first.locator(".crate-track-title")).toHaveCSS(
        "font-weight",
        "500",
      );
      const seek = section.getByRole("slider", { name: "Posición de muestra" });
      expect((await seek.boundingBox())!.height).toBe(width === 390 ? 44 : 40);
      const seekTrack = section.locator(".listen-player-progress-track");
      await expect(seekTrack).toHaveCSS("height", "2px");
      await expect(
        section.locator(".listen-player-progress-glow"),
      ).toBeVisible();
      await expect(section.locator(".listen-player-progress-glow")).toHaveCSS(
        "background-image",
        /linear-gradient/,
      );
      await section
        .getByRole("radio", { name: "Compacta", exact: true })
        .click();
      await expect(seekTrack).toHaveCSS("height", "1px");
      await section.getByRole("radio", { name: "Cómoda", exact: true }).click();
      const height = (await first.boundingBox())!.height;
      expect(height).toBeGreaterThanOrEqual(56);
      expect(
        await first.evaluate(
          (element) => getComputedStyle(element, "::before").width,
        ),
      ).toBe("2px");
      expect(
        await first
          .locator(".crate-track-title")
          .evaluate((element) => getComputedStyle(element).color),
      ).toBe(
        await first.evaluate(
          (element) => getComputedStyle(element, "::before").backgroundColor,
        ),
      );
      await expect(first.getByText("4:03")).toHaveCSS(
        "font-family",
        /JetBrains Mono/,
      );
      await expect(third.locator(".crate-track-analysis")).toHaveCount(0);
      if (width === 1440) {
        await expect(first.getByText("124 · 8A")).toBeVisible();
        await expect(first.getByText("124 · 8A")).toHaveCSS(
          "font-size",
          "10.5px",
        );
        await expect(second.locator(".crate-track-index")).toBeVisible();
        await second
          .getByRole("button", {
            name: "Reproducir Todo lo que queda al volver a casa",
          })
          .focus();
        await expect(second.locator(".crate-track-index")).toBeHidden();
        await expect(second.locator(".crate-track-glyph")).toBeVisible();
      }
      await second.focus();
      await page.keyboard.press("Enter");
      await expect(second).toHaveAttribute("aria-current", "true");
      await expect(first).not.toHaveAttribute("aria-current");
      const pause = second.getByRole("button", {
        name: "Pausar Todo lo que queda al volver a casa",
      });
      await expect(pause).toBeVisible();
      await pause.click();
      await expect(
        second.getByRole("button", {
          name: "Reproducir Todo lo que queda al volver a casa",
        }),
      ).toBeVisible();
      expect((await first.boundingBox())!.height).toBe(height);
      await second
        .getByRole("button", {
          name: "Acciones de Todo lo que queda al volver a casa",
        })
        .click();
      await page
        .getByRole("menuitem", { name: "Añadir a la cola de muestra" })
        .click();
      const outcome = section.getByRole("status", {
        name: "Última acción de la muestra",
      });
      await expect(outcome).toContainText("Añadida a la cola de muestra");
      await expect(second).toHaveAttribute("aria-current", "true");
      if (width === 390) {
        for (const button of await rows.locator("button").all()) {
          const box = (await button.boundingBox())!;
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.height).toBeGreaterThanOrEqual(44);
        }
        expect(
          (await second.locator(".crate-track-glyph").boundingBox())!.width,
        ).toBe(40);
      }
      const grid = section.getByRole("figure", {
        name: "Portadas compartidas",
      });
      const card = grid.getByRole("article").first();
      const art = card.locator('[data-slot="entity-artwork"]');
      const before = (await art.boundingBox())!;
      expect(before.width).toBeCloseTo(before.height, 0);
      await expect(card).toHaveCSS("box-shadow", "none");
      await expect(card).toHaveCSS("transform", "none");
      await expect(card.getByText("2019 · LP")).toHaveCSS(
        "font-family",
        /JetBrains Mono/,
      );
      await expect(card.getByText("2019 · LP")).toHaveCSS(
        "font-size",
        "10.5px",
      );
      if (width === 1440) {
        await card.hover();
        await expect(card).toHaveCSS("transform", "none");
        const after = (await art.boundingBox())!;
        expect(after.width).toBe(before.width);
        expect(after.height).toBe(before.height);
      }
      expect(
        await art.evaluate(
          (element) => getComputedStyle(element, "::after").boxShadow,
        ),
      ).toContain("1px");
      const play = card.getByRole("button", {
        name: "Reproducir Luz de octubre",
      });
      if (width === 1440) {
        await card
          .getByRole("button", { name: "Luz de octubre", exact: false })
          .first()
          .focus();
      }
      await expect(play).toBeVisible();
      await play.click();
      await expect(outcome).toHaveText("Álbum de muestra en reproducción.");
      if (width === 390) {
        const box = (await play.boundingBox())!;
        expect(box.width).toBe(44);
        expect(box.height).toBe(44);
        await expect(play).toHaveCSS("background-clip", "content-box");
      }
      await expect(grid.getByTestId("media-cover-fallback")).toHaveText("UT");
      const small = section.getByRole("button", {
        name: "Probar play pequeño",
      });
      await expect(small).toHaveCSS("box-shadow", "none");
      await expect(small).toHaveCSS("transform", "none");
      expect((await small.boundingBox())!.width).toBe(width === 390 ? 44 : 40);
      const label = section.locator("#track-outcome-label");
      const labelBox = (await label.boundingBox())!;
      const outcomeBox = (await outcome.boundingBox())!;
      expect(outcomeBox.y - labelBox.y - labelBox.height).toBeCloseTo(8, 0);
      const table = section.getByRole("table", { name: "Pistas de Admin" });
      const header = table.locator("thead");
      await expect(header).toHaveCSS("position", "sticky");
      await expect(
        table.getByRole("columnheader", { name: "Pista", exact: true }),
      ).toHaveCSS("font-family", /JetBrains Mono/);
      await expect(
        table.getByRole("columnheader", { name: "Pista", exact: true }),
      ).toHaveCSS("font-size", "10.5px");
      const container = table.locator("..");
      await container.scrollIntoViewIfNeeded();
      const headerY = (await header.boundingBox())!.y;
      await container.evaluate((element) => {
        element.scrollTop = 80;
      });
      expect((await header.boundingBox())!.y).toBeCloseTo(headerY, 0);
      await table
        .getByRole("button", { name: "Descargar muestra 1", exact: true })
        .click();
      await expect(outcome).toContainText("No se genera un archivo");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
      expect(requests).toEqual([]);
      expect(
        await page.evaluate(() => Reflect.get(window, "__trackWrites")),
      ).toEqual([]);
      const sectionHeight = await section.evaluate((element) =>
        Math.ceil(element.getBoundingClientRect().height),
      );
      await page.setViewportSize({ width, height: sectionHeight + 64 });
      await section.scrollIntoViewIfNeeded();
      const path = info.outputPath(`checkpoint-1s-${width}.png`);
      await section.screenshot({ path, animations: "disabled" });
      await info.attach("Checkpoint1S advisory", {
        path,
        contentType: "image/png",
      });
    });
  });
}
test("Admin comparison columns drop at the documented viewport boundaries", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1001, height: 1000 });
  await page.goto("/#pistas");
  const table = page.getByRole("table", { name: "Pistas de Admin" });
  const detail = table.locator("thead .crate-table-detail");
  const secondary = table.locator("thead .crate-table-secondary").first();
  await expect(detail).toBeVisible();
  await page.setViewportSize({ width: 1000, height: 1000 });
  await expect(detail).toBeHidden();
  await expect(secondary).toBeVisible();
  await page.setViewportSize({ width: 760, height: 1000 });
  await expect(secondary).toBeHidden();
  await expect(
    table.getByRole("columnheader", { name: "Duración" }),
  ).toBeVisible();
});

test("narrow desktop rows preserve readable titles and every real control", async ({
  page,
}) => {
  await page.goto("/#pistas");
  const row = page
    .getByRole("figure", { name: "Filas de Listen" })
    .getByRole("group", { name: "La luz entre las hojas", exact: true });
  await expect(row).toBeVisible();
  for (const width of [300, 360]) {
    await row.evaluate((element, width) => {
      (element as HTMLElement).style.width = `${width}px`;
    }, width);
    const box = (await row.boundingBox())!;
    expect(
      (await row.locator(".crate-track-title").boundingBox())!.width,
    ).toBeGreaterThanOrEqual(80);
    await expect(row.locator(".crate-track-analysis")).toBeHidden();
    for (const button of await row.locator("button").all())
      expect(
        (await button.boundingBox())!.x + (await button.boundingBox())!.width,
      ).toBeLessThanOrEqual(box.x + box.width);
  }
});
test.describe("touch tablet", () => {
  test.use({ viewport: { width: 1024, height: 1000 }, hasTouch: true });
  test("all card actions include a 44px menu target", async ({ page }) => {
    await page.goto("/#pistas");
    const card = page
      .getByRole("figure", { name: "Portadas compartidas" })
      .getByRole("article")
      .first();
    const menu = card.getByRole("button", { name: "More actions" });
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  });
});

test("numeric management cells align to the right", async ({ page }) => {
  await page.goto("/#pistas");
  const table = page.getByRole("table", { name: "Pistas de Admin" });
  await expect(
    table.getByRole("cell", { name: "4:03", exact: true }).first(),
  ).toHaveCSS("text-align", "right");
});

test("Listen keeps its layered play, advancing ring and motion preferences", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/#pistas");
  const row = page.getByRole("group", {
    name: "La luz entre las hojas",
    exact: true,
  });
  const progress = row.getByTestId("track-row-playback-progress");
  const ring = progress.locator("circle").last();
  const offset = async () =>
    Number(await ring.getAttribute("stroke-dashoffset"));
  const trail = page.locator("#pistas .listen-player-progress-trail");
  const position = page.locator("#pistas .listen-player-progress-position");
  const beforeWidth = await position.getAttribute("style");
  const before = await offset();
  expect(before).toBeGreaterThan(0);
  await row
    .getByRole("button", { name: "Reproducir La luz entre las hojas" })
    .click();
  await expect(progress.locator(".track-row-playback-aura")).toHaveCSS(
    "animation-name",
    "cratePlayAuraPulse",
  );
  await page.clock.fastForward(2000);
  await expect.poll(offset).toBeLessThan(before);
  expect(await position.getAttribute("style")).not.toBe(beforeWidth);
  await row
    .getByRole("button", { name: "Pausar La luz entre las hojas" })
    .click();
  const paused = await offset();
  await page.clock.fastForward(2000);
  expect(await offset()).toBe(paused);
  const slider = page.getByRole("slider", { name: "Posición de muestra" });
  await slider.press("Home");
  await expect(page.locator("#pistas .listen-player-progress")).toHaveCSS(
    "outline-style",
    "solid",
  );
  await expect.poll(offset).toBeGreaterThan(paused);
  await slider.press("End");
  await expect.poll(offset).toBe(0);
  await row
    .getByRole("button", { name: "Reproducir La luz entre las hojas" })
    .click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const layer of ["aura", "rim", "core"]) {
    await expect(progress.locator(`.track-row-playback-${layer}`)).toHaveCSS(
      "animation-name",
      "none",
    );
  }
  for (const selector of [
    ".listen-player-progress-position",
    ".listen-player-progress-thumb",
    ".listen-player-progress-thumb-active",
  ]) {
    await expect(page.locator(`#pistas ${selector}`).first()).toHaveCSS(
      "transition-duration",
      "0s",
    );
  }
  await page.evaluate(() => {
    document.documentElement.dataset.crateEffects = "off";
  });
  await expect(progress.locator(".track-row-playback-aura")).toBeHidden();
  await expect(ring).toHaveCSS("filter", "none");
  await expect(progress).toHaveCSS("box-shadow", "none");
  await expect(trail).toBeHidden();
});

for (const width of [1440, 390]) {
  test(`progress head follows the beam through uninterrupted dragging at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/#pistas");
    const slider = page.getByRole("slider", { name: "Posición de muestra" });
    const transport = page.locator("#pistas .listen-player-progress");
    await slider.press("Home");
    await slider.scrollIntoViewIfNeeded();
    const box = (await slider.boundingBox())!;
    await transport.evaluate((element) => {
      const recording = {
        frames: [] as { gaps: number[]; vertical: number[]; end: number }[],
        running: true,
        frame: 0,
      };
      Reflect.set(window, "__seekRecording", recording);
      function sample() {
        const beam = element.querySelector(
          ":scope > .listen-player-progress-fill, .listen-player-progress-position > .listen-player-progress-fill",
        )!;
        const line = beam.getBoundingClientRect();
        const heads = [
          ...element.querySelectorAll(
            ".listen-player-progress-thumb, .listen-player-progress-thumb-active",
          ),
        ].map((head) => head.getBoundingClientRect());
        recording.frames.push({
          end: line.right,
          gaps: heads.map((head) =>
            Math.abs(head.x + head.width / 2 - line.right),
          ),
          vertical: heads.map((head) =>
            Math.abs(head.y + head.height / 2 - line.y - line.height / 2),
          ),
        });
        if (recording.running) recording.frame = requestAnimationFrame(sample);
      }
      sample();
    });
    await page.mouse.move(box.x + 8, box.y + box.height / 2);
    await page.mouse.down();
    let previous = 8 / box.width;
    for (const fraction of [0.9, 0.2, 0.8, 0.35, 0.7]) {
      for (let step = 1; step <= 8; step++) {
        await page.mouse.move(
          box.x + box.width * (previous + ((fraction - previous) * step) / 8),
          box.y + box.height / 2,
        );
        // Wait for a real paint between inputs so fast CDP delivery cannot coalesce
        // the entire drag into a few positions. Both animation clocks keep running.
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            ),
        );
      }
      previous = fraction;
    }
    expect(Number(await slider.inputValue())).toBeGreaterThan(120);
    await page.mouse.up();
    await slider.press("End");
    await slider.press("Home");
    await page
      .getByRole("button", {
        name: "Reproducir La luz entre las hojas",
        exact: true,
      })
      .click();
    await expect.poll(() => slider.inputValue()).not.toBe("0");
    await page
      .getByRole("button", {
        name: "Pausar La luz entre las hojas",
        exact: true,
      })
      .click();
    const frames = await page.evaluate(() => {
      const recording = Reflect.get(window, "__seekRecording") as {
        frames: { gaps: number[]; vertical: number[]; end: number }[];
        running: boolean;
        frame: number;
      };
      recording.running = false;
      cancelAnimationFrame(recording.frame);
      return recording.frames;
    });
    const evidence = info.outputPath("natural-seek-frames.json");
    await writeFile(
      evidence,
      JSON.stringify({
        frames,
        distinctEdges: new Set(frames.map((frame) => Math.round(frame.end)))
          .size,
        maxGap: Math.max(...frames.flatMap((frame) => frame.gaps)),
        maxVerticalGap: Math.max(...frames.flatMap((frame) => frame.vertical)),
      }),
    );
    await info.attach("natural-seek-frames", {
      path: evidence,
      contentType: "application/json",
    });
    expect(frames.length).toBeGreaterThan(30);
    expect(
      new Set(frames.map((frame) => Math.round(frame.end))).size,
    ).toBeGreaterThan(10);
    expect(Math.max(...frames.flatMap((frame) => frame.gaps))).toBeLessThan(
      0.75,
    );
    expect(Math.max(...frames.flatMap((frame) => frame.vertical))).toBeLessThan(
      0.75,
    );
    await expect(transport.locator(".listen-player-progress-thumb")).toHaveCSS(
      "width",
      "4px",
    );
    await expect(
      transport.locator(".listen-player-progress-thumb-active"),
    ).toHaveCSS("width", "6px");
    await expect(transport.locator(".listen-player-progress-trail")).toHaveCSS(
      "height",
      "8px",
    );
  });
}
