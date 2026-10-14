import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { createDirector, type ChapterModule, type Device } from "./director";
import { createEventLog } from "./events";

const CHAPTERS = ["library", "player", "radio", "paths", "offline"] as const;
const VIEWPORTS: Record<Device, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};
const MAX_SECONDS = 25;

const [chapter, device] = process.argv.slice(2) as [string, Device];
if (
  !CHAPTERS.includes(chapter as (typeof CHAPTERS)[number]) ||
  !(device in VIEWPORTS)
) {
  console.error(
    `Usage: tsx capture.ts <${CHAPTERS.join("|")}> <desktop|mobile>`,
  );
  process.exit(1);
}

const statePath = ".auth/state.json";
if (!existsSync(statePath)) {
  console.error(`Missing ${statePath}. Run "npm run login" first.`);
  process.exit(1);
}

console.warn(
  "Warning: this drives the real Listen app. Playback during the recording creates play events and scrobbles for the signed-in user.",
);

const baseUrl = process.env.SCREENCAST_URL;
if (!baseUrl) {
  console.error("Set SCREENCAST_URL to the Listen instance to record.");
  process.exit(1);
}
const viewport = VIEWPORTS[device];
const outDir = join("out", chapter, device);
const framesDir = join(outDir, "frames");
await rm(outDir, { recursive: true, force: true });
await mkdir(framesDir, { recursive: true });

const {
  default: script,
  start: startPath,
  warm,
} = (await import(`./chapters/${chapter}.ts`)) as ChapterModule;

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({
  storageState: statePath,
  viewport,
  deviceScaleFactor: 2,
  isMobile: device === "mobile",
  hasTouch: device === "mobile",
});
const page = await context.newPage();
page.setDefaultTimeout(15_000);
await page.addInitScript(() => {
  localStorage.setItem("listen-eq-enabled", "true");
  localStorage.removeItem("listen-player-state:v1");
});

const rehearsal = createDirector(page, device, createEventLog(0), baseUrl);
if (warm) await warm(rehearsal);
await rehearsal.goto(startPath(device));
await page.getByTestId("listen-content").waitFor();
await rehearsal.pause(1500);

const cdp = await context.newCDPSession(page);
const start = Date.now();
const frames: { file: string; t: number }[] = [];
const pending: Promise<void>[] = [];
cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
  const file = `${String(frames.length).padStart(5, "0")}.png`;
  const timestamp = metadata.timestamp ?? Date.now() / 1000;
  frames.push({ file, t: Math.round(timestamp * 1000 - start) / 1000 });
  pending.push(writeFile(join(framesDir, file), Buffer.from(data, "base64")));
  void cdp.send("Page.screencastFrameAck", { sessionId });
});
await cdp.send("Page.startScreencast", {
  format: "png",
  maxWidth: viewport.width * 2,
  maxHeight: viewport.height * 2,
});

const log = createEventLog(start, {
  x: viewport.width / 2,
  y: viewport.height / 2,
});
try {
  await script(createDirector(page, device, log, baseUrl));
} finally {
  await cdp.send("Page.stopScreencast");
  await Promise.all(pending);
  await writeFile(join(outDir, "frames.json"), JSON.stringify(frames));
  await writeFile(
    join(outDir, "events.json"),
    JSON.stringify(
      { chapter, device, viewport, deviceScaleFactor: 2, events: log.events },
      null,
      2,
    ),
  );
  await browser.close();
}

const seconds = (Date.now() - start) / 1000;
console.log(
  `Captured ${frames.length} frames and ${
    log.events.length
  } events in ${seconds.toFixed(1)} s to ${outDir}`,
);
if (seconds > MAX_SECONDS)
  console.warn(
    `Chapter ran ${seconds.toFixed(1)} s, over the ${MAX_SECONDS} s budget.`,
  );
