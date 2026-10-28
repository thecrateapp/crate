import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const searchSource = readFileSync(
  resolve(
    process.cwd(),
    "app/listen/src/components/layout/topbar/TopBarSearchView.tsx",
  ),
  "utf8",
);
const searchMotion = searchSource.match(
  /transition-\[background-color,border-color,box-shadow,transform\] duration-(\d+) ease-\[cubic-bezier\(([^)]+)\)\]/,
);
if (!searchMotion) throw new Error("The real Listen search motion is missing");
const duration = Number(searchMotion[1]);
const easing = `cubic-bezier(${searchMotion[2]
  .split(",")
  .map(Number)
  .join(", ")})`;

async function ring(target: Locator) {
  await expect
    .poll(() =>
      target.evaluate((element) =>
        element
          .getAnimations()
          .some((animation) => animation.id === "crate-focus-ring"),
      ),
    )
    .toBe(true);
  return target.evaluate((element) => {
    const animation = element
      .getAnimations()
      .find((candidate) => candidate.id === "crate-focus-ring")!;
    (element as HTMLElement & { __testFocusRing?: Animation }).__testFocusRing =
      animation;
    animation.pause();
    animation.currentTime = 0;
    return animation.effect!.getTiming();
  });
}

async function at(target: Locator, time: number) {
  return target.evaluate((element, currentTime) => {
    const animation = (element as HTMLElement & { __testFocusRing?: Animation })
      .__testFocusRing;
    if (!animation) throw new Error("Missing focus animation");
    animation.pause();
    animation.currentTime = currentTime;
    const style = getComputedStyle(element);
    const shadows = style.boxShadow
      .split(/,(?![^()]*\))/)
      .map((shadow) => shadow.trim());
    const last = shadows.pop() ?? "";
    const color = last.match(/rgba?\([^)]+\)/)?.[0];
    const geometry = last
      .replace(/rgba?\([^)]+\)|inset/g, "")
      .match(/-?\d*\.?\d+/g)
      ?.map(Number);
    if (!color || geometry?.length !== 4)
      throw new Error(`Missing additive focus shadow: ${style.boxShadow}`);
    return {
      color,
      spread: geometry[3],
      inset: last.includes("inset"),
      baseShadow: shadows.join(", "),
      outlineColor: style.outlineColor,
      marker: element.hasAttribute("data-crate-focus-motion"),
    };
  }, time);
}

function opacity(color: string) {
  const parts = color.match(/[\d.]+/g)?.map(Number) ?? [];
  return parts[3] ?? 1;
}

async function nativeSearchRing(page: Page, leaving: boolean, time: number) {
  return page.evaluate(
    ({ leaving, time, duration, easing }) => {
      const reference = document.createElement("span");
      const off = "0px 0px 0px 0px transparent";
      const on = "var(--shadow-focus)";
      reference.style.position = "fixed";
      reference.style.pointerEvents = "none";
      reference.style.boxShadow = leaving ? on : off;
      document.body.append(reference);
      void getComputedStyle(reference).boxShadow;
      reference.style.transition = `box-shadow ${duration}ms ${easing}`;
      reference.style.boxShadow = leaving ? off : on;
      const transition = reference
        .getAnimations()
        .find(
          (animation) =>
            animation instanceof CSSTransition &&
            animation.transitionProperty === "box-shadow",
        );
      if (!transition)
        throw new Error("Native Listen search shadow did not transition");
      transition.pause();
      transition.currentTime = time;
      const computed = getComputedStyle(reference).boxShadow;
      const timing = transition.effect!.getTiming();
      const shadow = computed.match(
        /^(rgba?\([^)]+\))\s+[-.\d]+px\s+[-.\d]+px\s+[-.\d]+px\s+([-.\d]+)px$/,
      );
      if (!shadow) throw new Error(`Unexpected native ring: ${computed}`);
      reference.remove();
      return {
        color: shadow[1],
        spread: Number(shadow[2]),
        duration: timing.duration,
        easing: timing.easing,
      };
    },
    { leaving, time, duration, easing },
  );
}

function expectContinuousGeometry(
  actual: Awaited<ReturnType<typeof at>>,
  expected: Awaited<ReturnType<typeof at>>,
) {
  expect(actual.color).toBe(expected.color);
  expect(actual.spread).toBe(expected.spread);
  expect(actual.inset).toBe(expected.inset);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/#foco");
  await page.keyboard.press("Tab");
});

test("animates the ring on and fully off with the real Listen search timing", async ({
  page,
}) => {
  const control = page.getByRole("button", {
    name: "Añadir a la cola",
    exact: true,
  });
  const baseShadow = await control.evaluate((element) => {
    (element as HTMLElement).style.boxShadow = "0 8px 12px rgba(0, 0, 0, 0.5)";
    const reference = document.createElement("span");
    reference.style.boxShadow = (element as HTMLElement).style.boxShadow;
    document.body.append(reference);
    const computed = getComputedStyle(reference).boxShadow;
    reference.remove();
    return computed;
  });
  await control.focus();
  const timing = await ring(control);
  expect(timing.duration).toBe(duration);
  expect(timing.easing).toBe(easing);
  const start = await at(control, 0);
  const middle = await at(control, 50);
  const end = await at(control, duration);
  expect(start.spread).toBe(0);
  expect(middle.spread).toBeGreaterThan(0);
  expect(middle.spread).toBeLessThan(2);
  expect(end.spread).toBe(2);
  expect(middle.baseShadow).toBe(baseShadow);
  expect(middle.inset).toBe(false);
  expect(middle.marker).toBe(true);
  expect(opacity(middle.outlineColor)).toBe(0);
  expect(opacity(start.color)).toBe(0);
  expect(opacity(middle.color)).toBeGreaterThan(0);
  expect(opacity(middle.color)).toBeLessThan(1);
  expect(end.color).toBe("rgb(6, 182, 212)");
  const nativeEntry = await nativeSearchRing(page, false, 50);
  expect(nativeEntry.duration).toBe(timing.duration);
  expect(nativeEntry.easing).toBe(timing.easing);
  expect(opacity(middle.color)).toBeCloseTo(opacity(nativeEntry.color), 2);
  expect(Math.abs(middle.spread - nativeEntry.spread)).toBeLessThanOrEqual(
    0.01,
  );
  for (const time of [100, 200, 350]) {
    const actual = await at(control, time);
    const reference = await nativeSearchRing(page, false, time);
    expect(Math.abs(actual.spread - reference.spread)).toBeLessThanOrEqual(
      0.01,
    );
    expect(
      Math.abs(opacity(actual.color) - opacity(reference.color)),
    ).toBeLessThanOrEqual(0.01);
  }
  await control.evaluate((element) => {
    (
      element as HTMLElement & { __testFocusRing?: Animation }
    ).__testFocusRing!.finish();
  });
  await expect(control).not.toHaveAttribute("data-crate-focus-motion");
  await expect(control).toHaveCSS("outline-color", "rgb(6, 182, 212)");
  await expect(control).toHaveCSS("outline-width", "2px");
  await expect(control).toHaveCSS("box-shadow", baseShadow);
  await page
    .getByRole("button", { name: "Reproducir ahora", exact: true })
    .focus();
  await ring(control);
  const exitStart = await at(control, 0);
  const exitMiddle = await at(control, 50);
  const exitEnd = await at(control, duration);
  expect(exitStart.color).toBe("rgb(6, 182, 212)");
  expect(opacity(exitMiddle.color)).toBeGreaterThan(0);
  expect(opacity(exitMiddle.color)).toBeLessThan(1);
  expect(exitStart.spread).toBe(2);
  expect(exitMiddle.spread).toBeGreaterThan(0);
  expect(exitMiddle.spread).toBeLessThan(2);
  expect(exitEnd.spread).toBe(0);
  expect(exitMiddle.baseShadow).toBe(baseShadow);
  expect(exitMiddle.inset).toBe(false);
  expect(opacity(exitMiddle.outlineColor)).toBe(0);
  expect(opacity(exitEnd.color)).toBe(0);
  const nativeExit = await nativeSearchRing(page, true, 50);
  expect(nativeExit.duration).toBe(timing.duration);
  expect(nativeExit.easing).toBe(timing.easing);
  expect(opacity(exitMiddle.color)).toBeCloseTo(opacity(nativeExit.color), 2);
  expect(Math.abs(exitMiddle.spread - nativeExit.spread)).toBeLessThanOrEqual(
    0.01,
  );
  for (const time of [100, 200, 350]) {
    const actual = await at(control, time);
    const reference = await nativeSearchRing(page, true, time);
    expect(Math.abs(actual.spread - reference.spread)).toBeLessThanOrEqual(
      0.01,
    );
    expect(
      Math.abs(opacity(actual.color) - opacity(reference.color)),
    ).toBeLessThanOrEqual(0.01);
  }
  await control.evaluate((element) =>
    (
      element as HTMLElement & { __testFocusRing?: Animation }
    ).__testFocusRing!.finish(),
  );
  await expect(control).not.toHaveAttribute("data-crate-focus-motion");
  await expect(control).toHaveCSS("box-shadow", baseShadow);
});

test("retargets a ring interrupted during both entry and exit without flashing", async ({
  page,
}) => {
  const first = page.getByRole("button", {
    name: "01 Abrir canción 4:11",
    exact: true,
  });
  const next = page.getByRole("button", {
    name: "Reproducir ahora",
    exact: true,
  });
  await first.focus();
  await ring(first);
  const entering = await at(first, 50);
  await next.focus();
  await ring(first);
  expectContinuousGeometry(await at(first, 0), entering);
  const leaving = await at(first, 50);
  await first.focus();
  await ring(first);
  expectContinuousGeometry(await at(first, 0), leaving);
  expect((await at(first, duration)).color).toBe("rgb(6, 182, 212)");
});

test("preserves the inset geometry, elevation and existing control transitions during exit", async ({
  page,
}) => {
  const control = page.getByRole("button", {
    name: "01 Abrir canción 4:11",
    exact: true,
  });
  const before = await control.evaluate((element) => {
    const css = getComputedStyle(element);
    const { width, height } = element.getBoundingClientRect();
    return {
      shadow: css.boxShadow,
      transitions: css.transition,
      width,
      height,
    };
  });
  await control.focus();
  await ring(control);
  const entryStart = await at(control, 0);
  const entryMiddle = await at(control, 50);
  const entryEnd = await at(control, duration);
  expect(entryStart.spread).toBe(0);
  expect(entryMiddle.spread).toBeGreaterThan(0);
  expect(entryMiddle.spread).toBeLessThan(2);
  expect(entryMiddle.inset).toBe(true);
  expect(entryEnd.spread).toBe(2);
  expect(entryEnd.inset).toBe(true);
  await control.evaluate((element) =>
    (
      element as HTMLElement & { __testFocusRing?: Animation }
    ).__testFocusRing!.finish(),
  );
  await page
    .getByRole("button", { name: "Añadir a la cola", exact: true })
    .focus();
  await ring(control);
  const during = await at(control, 50);
  expect(during.spread).toBeGreaterThan(0);
  expect(during.spread).toBeLessThan(2);
  expect(during.inset).toBe(true);
  const after = await control.evaluate((element, baseShadow) => {
    const css = getComputedStyle(element);
    const { width, height } = element.getBoundingClientRect();
    return {
      shadow: baseShadow || "none",
      transitions: css.transition,
      width,
      height,
    };
  }, during.baseShadow);
  expect(after).toEqual(before);
});

for (const source of ["system", "crate", "forced colors"] as const) {
  test(`keeps static focus without animations under ${source}`, async ({
    page,
  }) => {
    if (source === "system")
      await page.emulateMedia({ reducedMotion: "reduce" });
    if (source === "forced colors")
      await page.emulateMedia({ forcedColors: "active" });
    if (source === "crate")
      await page.evaluate(() => {
        document.documentElement.dataset.crateMotion = "reduced";
      });
    const control = page.getByRole("button", {
      name: "Añadir a la cola",
      exact: true,
    });
    await control.focus();
    await expect(control).not.toHaveAttribute("data-crate-focus-motion");
    await expect(control).toHaveCSS("outline-width", "2px");
    await expect(control).toHaveCSS("outline-style", "solid");
    expect(
      await control.evaluate(
        (element) =>
          element.getAnimations().filter((a) => a.id === "crate-focus-ring")
            .length,
      ),
    ).toBe(0);
    await control.blur();
    expect(
      await control.evaluate(
        (element) =>
          element.getAnimations().filter((a) => a.id === "crate-focus-ring")
            .length,
      ),
    ).toBe(0);
  });
}

for (const source of ["system", "crate", "forced colors"] as const) {
  test(`cancels an in-flight ring when ${source} changes`, async ({ page }) => {
    const control = page.getByRole("button", {
      name: "Añadir a la cola",
      exact: true,
    });
    await control.focus();
    await ring(control);
    await at(control, 50);
    if (source === "system")
      await page.emulateMedia({ reducedMotion: "reduce" });
    if (source === "forced colors")
      await page.emulateMedia({ forcedColors: "active" });
    if (source === "crate")
      await page.evaluate(() => {
        document.documentElement.dataset.crateMotion = "reduced";
      });
    await expect
      .poll(() =>
        control.evaluate(
          (element) =>
            element.getAnimations().filter((a) => a.id === "crate-focus-ring")
              .length,
        ),
      )
      .toBe(0);
    await expect(control).not.toHaveAttribute("data-crate-focus-motion");
    await expect(control).toHaveCSS("outline-width", "2px");
    await expect(control).toHaveCSS("outline-style", "solid");
  });
}
