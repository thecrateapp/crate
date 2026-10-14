import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";
import type { Device } from "./director";

const SIZES: Record<
  Device,
  { width: number; height: number; deviceScaleFactor: number }
> = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 2 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 3 },
};
const MAX_BYTES = 250 * 1024;
const QUALITIES = [80, 75, 70, 65, 60];
const PLAYER_ALBUM = "/artists/sunny-day-real-estate/diary-remastered";
const OFFLINE_ALBUM = "/artists/repion/repion";
const ARTIST = "/artists/deftones";
const OUT_DIR = "out/shots";
const PUBLIC_DIR = "../../app/web/public/shots/listen";
const INDEX_FILE = "../../app/web/src/content/shots.ts";

type Shot = {
  name: string;
  alt: string;
  take: (page: Page, device: Device) => Promise<void>;
};

const baseUrl = process.env.SCREENCAST_URL;
if (!baseUrl) {
  console.error("Set SCREENCAST_URL to the Listen instance to capture.");
  process.exit(1);
}
const statePath = ".auth/state.json";
if (!existsSync(statePath)) {
  console.error(`Missing ${statePath}. Run "npm run login" first.`);
  process.exit(1);
}

const hostname = new URL(baseUrl).hostname;
const forbidden = [hostname, hostname.split(".").at(-2) ?? hostname];

async function settle(page: Page) {
  await page
    .waitForLoadState("networkidle", { timeout: 8_000 })
    .catch(() => undefined);
  await page
    .waitForFunction(
      () => [...document.images].every((image) => image.complete),
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => undefined);
  await page.waitForTimeout(800);
}

async function open(page: Page, path: string) {
  await page.goto(new URL(path, baseUrl).toString(), {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.getByTestId("listen-content").waitFor();
  await settle(page);
}

function visible(page: Page, name: string) {
  return page
    .getByRole("button", { name, exact: true })
    .filter({ visible: true })
    .first();
}

async function openPlayer(page: Page, device: Device) {
  await open(page, PLAYER_ALBUM);
  await page
    .getByTestId("album-action-row")
    .getByRole("button", { name: "Play", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: device === "desktop" ? "Expand player" : "Open fullscreen player",
    })
    .click();
  await page
    .getByText("Lyrics", { exact: true })
    .filter({ visible: true })
    .last()
    .waitFor({ timeout: 45_000 });
  await settle(page);
}

const SHOTS: Shot[] = [
  {
    name: "home",
    alt: "Crate Listen home with the featured artist and recently played rows",
    take: (page) => open(page, "/"),
  },
  {
    name: "album",
    alt: "Album page with artwork, genre tags, offline and radio actions and the tracklist",
    take: (page) => open(page, PLAYER_ALBUM),
  },
  {
    name: "artist",
    alt: "Artist page with biography, top tracks and radio, setlist and follow actions",
    take: (page) => open(page, ARTIST),
  },
  {
    name: "equalizer",
    alt: "Expanded player with the smart equalizer tuned to the track's genre",
    take: async (page, device) => {
      await openPlayer(page, device);
      await visible(page, "Equalizer").click();
      await settle(page);
    },
  },
  {
    name: "lyrics",
    alt: "Expanded player showing the lyrics of the playing track",
    take: async (page) => {
      await visible(page, "Close equalizer").click();
      await page
        .getByText("Lyrics", { exact: true })
        .filter({ visible: true })
        .last()
        .click();
      await settle(page);
    },
  },
  {
    name: "radio",
    alt: "Radio page with Discovery Radio, artist stations and genre stations",
    take: (page) => open(page, "/radio"),
  },
  {
    name: "paths",
    alt: "A music path tracing a route from rap to death metal through the library",
    take: async (page) => {
      await open(page, "/paths");
      await page
        .getByTestId("listen-content")
        .locator('a[href^="/paths/"]')
        .first()
        .click();
      await page.getByRole("button", { name: "Regenerate" }).waitFor();
      await settle(page);
    },
  },
  {
    name: "stats",
    alt: "Listening stats with minutes per day, active days and the artist of the period",
    take: (page) => open(page, "/stats"),
  },
  {
    name: "radar",
    alt: "Radar with upcoming shows and pre-releases from followed artists",
    take: (page) => open(page, "/upcoming"),
  },
  {
    name: "explore",
    alt: "Explore with radio, music paths, new arrivals and genre rooms",
    take: (page) => open(page, "/explore"),
  },
  {
    name: "offline",
    alt: "Offline mirror settings with an album mirrored on the device",
    take: async (page) => {
      await open(page, OFFLINE_ALBUM);
      const actions = page.getByTestId("album-action-row");
      const make = actions.getByRole("button", {
        name: "Make available offline",
        exact: true,
      });
      if (await make.isVisible()) await make.click();
      await actions
        .getByRole("button", { name: "Remove offline copy", exact: true })
        .waitFor({ timeout: 60_000 });
      await open(page, "/settings");
      const title = page.getByText("Offline mirror", { exact: true }).first();
      const note = page.getByText(/Marked items keep a local mirror/).first();
      const [titleBox, noteBox] = await Promise.all([
        title.boundingBox(),
        note.boundingBox(),
      ]);
      const viewport = page.viewportSize();
      if (titleBox && noteBox && viewport) {
        const fitNote = noteBox.y + noteBox.height + 80 - viewport.height;
        await page.mouse.wheel(0, Math.min(fitNote, titleBox.y - 84));
      }
      await settle(page);
    },
  },
];

function textOnScreen(page: Page) {
  return page.evaluate(() => {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    const range = document.createRange();
    const parts: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      range.selectNodeContents(node);
      const onScreen = [...range.getClientRects()].some(
        (rect) =>
          rect.width > 0 &&
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < window.innerHeight &&
          rect.left < window.innerWidth,
      );
      if (onScreen) parts.push(node.textContent);
    }
    return parts.join("\n");
  });
}

async function guard(page: Page, name: string) {
  const text = await textOnScreen(page);
  const leak = forbidden.find((word) =>
    text.toLowerCase().includes(word.toLowerCase()),
  );
  if (leak) throw new Error(`"${name}" shows the instance address; aborting.`);
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text))
    throw new Error(`"${name}" shows an email address; aborting.`);
}

function toWebp(png: string, webp: string) {
  for (const quality of QUALITIES) {
    execFileSync("cwebp", [
      "-quiet",
      "-q",
      String(quality),
      "-m",
      "6",
      png,
      "-o",
      webp,
    ]);
    if (statSync(webp).size <= MAX_BYTES) return quality;
  }
  console.warn(
    `${webp} is still over ${MAX_BYTES} bytes at the lowest quality.`,
  );
  return QUALITIES.at(-1);
}

const devices = (process.argv.slice(2) as Device[]).filter(
  (device) => device in SIZES,
);
const entries: {
  src: string;
  alt: string;
  device: Device;
  width: number;
  height: number;
}[] = [];
await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });
await mkdir(PUBLIC_DIR, { recursive: true });

const browser = await chromium.launch();
for (const device of devices.length
  ? devices
  : (["desktop", "mobile"] as Device[])) {
  const { width, height, deviceScaleFactor } = SIZES[device];
  const context = await browser.newContext({
    storageState: statePath,
    viewport: { width, height },
    deviceScaleFactor,
    isMobile: device === "mobile",
    hasTouch: device === "mobile",
  });
  await context.addInitScript(() => {
    localStorage.setItem("listen-eq-enabled", "true");
    localStorage.removeItem("listen-player-state:v1");
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  for (const shot of SHOTS) {
    await shot.take(page, device);
    await guard(page, shot.name);
    const file = `${shot.name}-${device}`;
    const png = join(OUT_DIR, `${file}.png`);
    await page.screenshot({ path: png, animations: "disabled", caret: "hide" });
    const quality = toWebp(png, join(PUBLIC_DIR, `${file}.webp`));
    const bytes = statSync(join(PUBLIC_DIR, `${file}.webp`)).size;
    console.log(`${file}.webp q${quality} ${(bytes / 1024).toFixed(0)} KB`);
    entries.push({
      src: `/shots/listen/${file}.webp`,
      alt: shot.alt,
      device,
      width: width * deviceScaleFactor,
      height: height * deviceScaleFactor,
    });
  }
  await context.close();
}
await browser.close();

const body = entries
  .map(
    (entry) =>
      `  {\n    src: "${entry.src}",\n    alt: ${JSON.stringify(
        entry.alt,
      )},\n    device: "${entry.device}",\n    width: ${
        entry.width
      },\n    height: ${entry.height},\n  },`,
  )
  .join("\n");
await writeFile(
  INDEX_FILE,
  `export interface Shot {\n  src: string;\n  alt: string;\n  device: "desktop" | "mobile";\n  width: number;\n  height: number;\n}\n\nexport const shots: Shot[] = [\n${body}\n];\n`,
);
console.log(`Wrote ${entries.length} screenshots and ${INDEX_FILE}`);
