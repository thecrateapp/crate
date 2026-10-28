import { expect, test } from "@playwright/test";

for (const host of ["storybook", "standalone"]) {
  for (const coarse of [false, true]) {
    test.describe(`${host} player motion ${coarse ? "coarse" : "fine"}`, () => {
      test.use({
        viewport: { width: coarse ? 375 : 1200, height: 900 },
        hasTouch: coarse,
      });
      test("disc phase, mode actions and Collection route disclosure remain stable", async ({
        page,
      }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(
          host === "storybook"
            ? "/iframe.html?id=reviews-1ba-player-motion--complete&viewMode=story"
            : "http://127.0.0.1:5186/review-1ba-player-motion.html",
        );
        await expect(
          page.getByRole("heading", { name: "Player motion and navigation" }),
        ).toBeVisible();
        const disc = page.getByRole("group", {
          name: "Disc playback · compositor and stable phase",
          exact: true,
        });
        const rotor = disc.locator(".spinning-disc-rotor");
        await disc.getByRole("button", { name: "Play", exact: true }).click();
        await expect
          .poll(() => rotor.evaluate((el) => el.getAnimations().length))
          .toBe(1);
        const start = await rotor.evaluate(
          (el) => el.getAnimations()[0]!.startTime,
        );
        const samples = await rotor.evaluate(
          (el) =>
            new Promise<Array<{ time: number; angle: number }>>((resolve) => {
              const frames: Array<{ time: number; angle: number }> = [];
              const take = (time: number) => {
                const matrix = new DOMMatrixReadOnly(
                  getComputedStyle(el).transform,
                );
                frames.push({
                  time,
                  angle: (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI,
                });
                if (frames.length === 20) resolve(frames);
                else requestAnimationFrame(take);
              };
              requestAnimationFrame(take);
            }),
        );
        for (let index = 1; index < samples.length; index++) {
          const previous = samples[index - 1]!,
            current = samples[index]!;
          const expected = (current.time - previous.time) * 0.12;
          const error =
            ((current.angle - previous.angle - expected + 540) % 360) - 180;
          expect(Math.abs(error)).toBeLessThan(1);
        }
        await disc
          .getByRole("button", { name: "Correct playback clock" })
          .click();
        expect(
          await rotor.evaluate((el) => el.getAnimations()[0]!.startTime),
        ).toBe(start);
        await disc.getByRole("button", { name: "Interface load" }).click();
        expect(
          await rotor.evaluate((el) => el.getAnimations()[0]!.startTime),
        ).toBe(start);
        await disc
          .getByRole("button", { name: "Buffering", exact: true })
          .click();
        await expect
          .poll(() => rotor.evaluate((el) => el.getAnimations().length))
          .toBe(0);
        const frozen = await rotor.evaluate(
          (el) => (el as HTMLElement).style.transform,
        );
        await page.waitForTimeout(100);
        expect(
          await rotor.evaluate((el) => (el as HTMLElement).style.transform),
        ).toBe(frozen);
        await disc
          .getByRole("button", { name: "Buffering", exact: true })
          .click();
        await expect
          .poll(() => rotor.evaluate((el) => el.getAnimations().length))
          .toBe(1);
        expect(
          await rotor.evaluate(
            (el) =>
              (
                el.getAnimations()[0]!.effect as KeyframeEffect
              ).getKeyframes()[0]!.transform,
          ),
        ).toBe(frozen);
        await disc.getByRole("button", { name: "Pause", exact: true }).click();
        await expect
          .poll(() => rotor.evaluate((el) => el.getAnimations().length))
          .toBe(0);
        await page.emulateMedia({ reducedMotion: "reduce" });
        await disc.getByRole("button", { name: "Play", exact: true }).click();
        await expect
          .poll(() => rotor.evaluate((el) => el.getAnimations().length))
          .toBe(0);
        const modes = page
          .getByRole("group", {
            name: "Display modes · icon actions without a container",
            exact: true,
          })
          .getByRole("radiogroup");
        for (const item of await modes.getByRole("radio").all()) {
          const box = (await item.boundingBox())!;
          expect(box.width).toBe(44);
          expect(box.height).toBe(44);
          await expect(item).toHaveCSS("border-width", "0px");
          expect((await item.textContent())?.trim()).toBe("");
        }
        await expect(modes).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        await modes
          .getByRole("radio", { name: "CD mode", exact: true })
          .focus();
        await page.keyboard.press("ArrowRight");
        await expect(
          modes.getByRole("radio", { name: "Cover mode", exact: true }),
        ).toBeChecked();
        const colors = await modes
          .getByRole("radio")
          .evaluateAll((items) =>
            items.map((el) => getComputedStyle(el.querySelector("svg")!).color),
          );
        expect(colors[0]).toBe(colors[2]);
        expect(colors[1]).not.toBe(colors[0]);
        const limited = page.getByRole("group", {
          name: "Display modes · mobile capability gate",
          exact: true,
        });
        await expect(limited.getByRole("radio")).toHaveCount(2);
        const nav = page.getByRole("group", {
          name: "Collection navigation · one item geometry across both levels",
          exact: true,
        });
        const collection = nav.getByRole("button", {
          name: "Collection",
          exact: true,
        });
        await expect(collection).toHaveAttribute("aria-expanded", "true");
        await collection.click();
        await expect(collection).toHaveAttribute("aria-expanded", "true");
        await nav.getByRole("link", { name: "Albums", exact: true }).click();
        await expect(collection).toHaveAttribute("aria-expanded", "true");
        await expect(
          nav.getByRole("link", { name: "Albums", exact: true }),
        ).toHaveAttribute("aria-current", "page");
        await nav.getByRole("link", { name: "Music", exact: true }).click();
        await expect(collection).toHaveAttribute("aria-expanded", "false");
        expect(errors).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
        ).toBe(false);
      });
    });
  }
}
