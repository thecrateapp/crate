import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { createDirector, type Device } from "../director";
import { createEventLog } from "../events";
import { APPS } from "./apps";
import { guardWrites } from "./guard";
import type { Takes } from "./takes";

const VIEWPORTS: Record<
  Device,
  { width: number; height: number; deviceScaleFactor: number }
> = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 2 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 3 },
};
const FILMS = ["listen", "admin"] as const;

const [film, takeId, device] = process.argv.slice(2) as [
  string,
  string,
  Device,
];
if (!FILMS.includes(film as (typeof FILMS)[number]) || !(device in VIEWPORTS)) {
  console.error(
    `Usage: tsx film/capture.ts <${FILMS.join("|")}> <take> <desktop|mobile>`,
  );
  process.exit(1);
}
const { TAKES } = (await import(`./takes/${film}.ts`)) as { TAKES: Takes };
const take = TAKES[takeId];
if (!take) {
  console.error(
    `Unknown ${film} take "${takeId}". Takes: ${Object.keys(TAKES).join(", ")}`,
  );
  process.exit(1);
}
if (!take.devices.includes(device)) {
  console.error(`Take "${takeId}" has no ${device} version.`);
  process.exit(1);
}

const { url: baseUrl, state } = APPS[take.app];
if (!existsSync(state)) {
  console.error(
    `Missing ${state}. Run "npm run film:login -- ${take.app}" first.`,
  );
  process.exit(1);
}

const viewport = VIEWPORTS[device];
const outDir = join("out", "film", "takes", film, takeId, device);
const framesDir = join(outDir, "frames");
await rm(outDir, { recursive: true, force: true });
await mkdir(framesDir, { recursive: true });

// The headless screencast delivers CSS pixels unless the browser itself is forced to the device
// scale, so the frames come out at 2x/3x and stay sharp when Remotion zooms in.
const browser = await chromium.launch({
  args: [
    "--autoplay-policy=no-user-gesture-required",
    `--force-device-scale-factor=${viewport.deviceScaleFactor}`,
  ],
});
const context = await browser.newContext({
  storageState: state,
  viewport: { width: viewport.width, height: viewport.height },
  deviceScaleFactor: viewport.deviceScaleFactor,
  isMobile: device === "mobile",
  hasTouch: device === "mobile",
});
const blocked = await guardWrites(context);
const page = await context.newPage();
page.setDefaultTimeout(15_000);
if (take.prepare) await take.prepare(page);

const rehearsal = createDirector(page, device, createEventLog(0), baseUrl);
if (take.warm) await take.warm(rehearsal);
await rehearsal.goto(take.start(device));
await page
  .waitForFunction(
    () => [...document.images].every((image) => image.complete),
    undefined,
    { timeout: 15_000 },
  )
  .catch(() =>
    console.warn("Some images were still loading when the take started."),
  );
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
  maxWidth: viewport.width * viewport.deviceScaleFactor,
  maxHeight: viewport.height * viewport.deviceScaleFactor,
});

const log = createEventLog(start, {
  x: viewport.width / 2,
  y: viewport.height / 2,
});
try {
  await take.run(createDirector(page, device, log, baseUrl));
} finally {
  await cdp.send("Page.stopScreencast");
  await Promise.all(pending);
  await writeFile(join(outDir, "frames.json"), JSON.stringify(frames));
  await writeFile(
    join(outDir, "events.json"),
    JSON.stringify(
      { film, take: takeId, device, viewport, events: log.events },
      null,
      2,
    ),
  );
  await writeFile(
    join(outDir, "blocked.json"),
    JSON.stringify(blocked, null, 2),
  );
  await browser.close();
}

console.log(
  `Captured ${frames.length} frames in ${((Date.now() - start) / 1000).toFixed(
    1,
  )} s to ${outDir}` +
    (blocked.length ? `; kept ${blocked.length} writes from production` : ""),
);
