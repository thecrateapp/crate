import type { Locator, Page } from "@playwright/test";
import type { EventLog, Point } from "./events";

export type Device = "desktop" | "mobile";

export interface Director {
  page: Page;
  device: Device;
  goto(path: string): Promise<void>;
  navigate(path: string): Promise<void>;
  click(target: Locator, position?: Point): Promise<void>;
  scroll(deltaY: number, over?: Locator): Promise<void>;
  pause(ms: number): Promise<void>;
}

export type ChapterScript = (director: Director) => Promise<void>;

export interface ChapterModule {
  default: ChapterScript;
  start(device: Device): string;
  warm?: ChapterScript;
}

const WHEEL_STEP = 60;
const WHEEL_INTERVAL = 16;

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
      await page.goto(new URL(path, baseUrl).toString(), {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await page
        .waitForLoadState("networkidle", { timeout: 8_000 })
        .catch(() => undefined);
    },
    async navigate(path) {
      await page.evaluate((next) => {
        const index = (window.history.state?.idx ?? 0) + 1;
        window.history.pushState(
          { usr: null, key: "screencast", idx: index },
          "",
          next,
        );
        window.dispatchEvent(
          new PopStateEvent("popstate", { state: window.history.state }),
        );
      }, path);
    },
    async click(target, position) {
      await target.waitFor({ state: "visible" });
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      if (!box) throw new Error(`No bounding box for ${target}`);
      log.click(box, Date.now(), position);
      if (device === "mobile") await target.tap({ position });
      else await target.click({ position });
    },
    async scroll(deltaY, over) {
      let point: Point | undefined;
      if (over) {
        const box = await over.boundingBox();
        if (!box) throw new Error(`No bounding box for ${over}`);
        point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await page.mouse.move(point.x, point.y);
      }
      log.scroll(deltaY, Date.now(), point);
      const steps = Math.max(1, Math.ceil(Math.abs(deltaY) / WHEEL_STEP));
      for (let step = 0; step < steps; step++) {
        await page.mouse.wheel(0, deltaY / steps);
        await page.waitForTimeout(WHEEL_INTERVAL);
      }
    },
    async pause(ms) {
      await page.waitForTimeout(ms);
    },
  };
}
