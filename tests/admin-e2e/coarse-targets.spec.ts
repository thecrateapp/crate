import { expect, test } from "@playwright/test";
import { coarseTargetSize, emulateCoarsePointer } from "./fixtures";

test("measures compact chips by their real coarse hit area", async ({
  page,
}) => {
  await page.setContent(`
    <style>
      button { position: relative; display: block; width: 32px; height: 32px; border: 0; padding: 0; margin: 32px; }
      button:disabled { pointer-events: none; }
      @media (pointer: coarse) {
        .crate-form-chip::after { content: ""; position: absolute; width: 44px; height: 44px; left: 50%; top: 50%; transform: translate(-50%, -50%); }
        .missing::after { content: none; }
        .blocked::after { pointer-events: none; }
      }
    </style>
    <button class="crate-form-chip" id="compact" data-clicks="0">OK</button>
    <button class="crate-form-chip missing" id="missing">No</button>
    <button class="crate-form-chip blocked" id="blocked">Off</button>
    <button class="crate-form-chip" id="disabled" disabled>Wait</button>
  `);
  const compact = page.locator("#compact");
  expect(await coarseTargetSize(compact)).toEqual({ width: 32, height: 32 });
  await emulateCoarsePointer(page);
  expect(await coarseTargetSize(compact)).toEqual({ width: 44, height: 44 });
  expect(await coarseTargetSize(page.locator("#missing"))).toEqual({
    width: 32,
    height: 32,
  });
  expect(await coarseTargetSize(page.locator("#blocked"))).toEqual({
    width: 32,
    height: 32,
  });
  expect(await coarseTargetSize(page.locator("#disabled"))).toEqual({
    width: 44,
    height: 44,
  });
  const box = await compact.boundingBox();
  expect(box!.height).toBe(32);
  await compact.evaluate((element) =>
    element.addEventListener("click", () =>
      element.setAttribute("data-clicks", "1"),
    ),
  );
  const point = { x: box!.x + box!.width / 2, y: box!.y - 4 };
  expect(
    await compact.evaluate(
      (element, point) =>
        document.elementFromPoint(point.x, point.y) === element,
      point,
    ),
  ).toBe(true);
  await page.mouse.click(point.x, point.y);
  await expect(compact).toHaveAttribute("data-clicks", "1");
});
