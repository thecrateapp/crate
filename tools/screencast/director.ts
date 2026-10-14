import type { Locator, Page } from "@playwright/test";
import type { EventLog } from "./events";

export type Device = "desktop" | "mobile";

export interface Director {
  page: Page;
  device: Device;
  goto(path: string): Promise<void>;
  click(target: Locator): Promise<void>;
  scroll(deltaY: number): Promise<void>;
  pause(ms: number): Promise<void>;
}

export type ChapterScript = (director: Director) => Promise<void>;

export function createDirector(
  page: Page,
  device: Device,
  log: EventLog,
  baseUrl: string,
): Director {
  return {
    page,
    device,
    async goto(path) {
      await page.goto(new URL(path, baseUrl).toString());
      await page.waitForLoadState("networkidle");
    },
    async click(target) {
      await target.waitFor({ state: "visible" });
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      if (!box) throw new Error(`No bounding box for ${target}`);
      log.click(box, Date.now());
      if (device === "mobile") await target.tap();
      else await target.click();
    },
    async scroll(deltaY) {
      log.scroll(deltaY, Date.now());
      await page.mouse.wheel(0, deltaY);
    },
    async pause(ms) {
      await page.waitForTimeout(ms);
    },
  };
}
