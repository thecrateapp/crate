import type { Locator, Page, TestInfo } from "@playwright/test";
import type { AudioAnalysisTrack } from "../../app/ui/src/components/album/TrackTable";
import { expect, test } from "./fixtures";
import { prepareAdminCapture } from "./screenshots";

const albumPath = "/artists/quicksand/quicksand-crystallize";
const analysisData: Record<string, AudioAnalysisTrack> = {
  crystallize: {
    tempo: 120,
    key: "D",
    scale: "minor",
    energy: 0.8,
    mood: { energetic: 0.8, relaxed: 0.2 },
    danceability: 0.6,
    valence: 0.4,
    acousticness: 0.1,
    instrumentalness: 0.2,
    loudness: -8,
    dynamic_range: 9,
    spectral_complexity: 0.7,
  },
  interiors: {
    tempo: 126,
    key: "D",
    scale: "minor",
    energy: 0.7,
    mood: { energetic: 0.7, relaxed: 0.3 },
    danceability: 0.5,
    valence: 0.5,
    acousticness: 0.2,
    instrumentalness: 0.3,
    loudness: -9,
    dynamic_range: 10,
    spectral_complexity: 0.6,
  },
  signal: {
    tempo: 114,
    key: "A",
    scale: "minor",
    energy: 0.6,
    mood: { energetic: 0.6, relaxed: 0.4 },
    danceability: 0.4,
    valence: 0.3,
    acousticness: 0.1,
    instrumentalness: 0.4,
    loudness: -10,
    dynamic_range: 11,
    spectral_complexity: 0.5,
  },
};

async function captureSurface(
  page: Page,
  surface: Locator,
  info: TestInfo,
  name: string,
) {
  await page.evaluate(() => document.fonts.ready);
  if (process.env.CRATE_VISUAL_SMOKE === "1") {
    await surface.screenshot({
      path: info.outputPath(`${name}.png`),
      animations: "disabled",
      caret: "hide",
    });
    return;
  }
  await expect(surface).toHaveScreenshot(`${name}.png`);
}

async function expectQuietHairline(
  surface: Locator,
  sides: readonly string[] = ["Top", "Right", "Bottom", "Left"],
) {
  await expect(surface).toBeVisible();
  const appearance = await surface.evaluate((element) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context)
      throw new Error("Cannot resolve border colors without canvas");
    const normalizeColor = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    };

    const probe = document.createElement("span");
    probe.style.cssText =
      "position:absolute;visibility:hidden;border:1px solid var(--border-quiet)";
    element.append(probe);
    const quietColor = getComputedStyle(probe).borderTopColor;
    probe.remove();

    const style = getComputedStyle(element);
    return {
      token: style.getPropertyValue("--border-quiet").trim(),
      quietColor: normalizeColor(quietColor),
      borders: ["Top", "Right", "Bottom", "Left"].map((side) => ({
        side,
        width: style.getPropertyValue(`border-${side.toLowerCase()}-width`),
        style: style.getPropertyValue(`border-${side.toLowerCase()}-style`),
        color: normalizeColor(
          style.getPropertyValue(`border-${side.toLowerCase()}-color`),
        ),
      })),
    };
  });

  expect(appearance.token, "The quiet border token is available").not.toBe("");
  expect(
    appearance.quietColor[3],
    "The quiet border is not transparent",
  ).toBeGreaterThan(0);
  expect(
    appearance.borders.filter((border) => sides.includes(border.side)),
  ).toEqual(
    sides.map((side) => ({
      side,
      width: "1px",
      style: "solid",
      color: appearance.quietColor,
    })),
  );
}

test.beforeEach(async ({ page }) => {
  await prepareAdminCapture(page);
});

test("rules the album audio analysis readings with a quiet hairline", async ({
  adminApi,
  openAdminPage,
  page,
}, info) => {
  adminApi.respondTo("/api/artists/23/analysis-data", analysisData);
  await openAdminPage(albumPath);
  const profile = page.getByRole("region", {
    name: "Audio analysis",
    exact: true,
  });
  await expect(
    profile.getByText("3 / 3 tracks with audio features", { exact: true }),
  ).toBeVisible();
  const labels = [
    "Mean tempo",
    "Most frequent key",
    "Mean loudness",
    "Mean dynamic range",
  ];
  const readings = profile
    .getByRole("term")
    .filter({ hasText: labels[0] })
    .locator("xpath=ancestor::dl[1]");
  for (const label of labels) {
    await expect(
      readings.getByRole("term").filter({ hasText: label }),
    ).toBeVisible();
  }
  await expect(readings.getByRole("definition")).toHaveCount(labels.length);

  await captureSurface(page, readings, info, "admin-audio-profile-kpis");

  await expectQuietHairline(profile, ["Top"]);
});

test("separates the crop modal with a quiet hairline without uploading", async ({
  adminApi,
  openAdminPage,
  page,
}, info) => {
  await openAdminPage(albumPath);
  await page
    .locator('input[type="file"][aria-label="Upload image"]')
    .setInputFiles({
      name: "crop-preview.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#14343d"/><circle cx="400" cy="400" r="260" fill="#06b6d4"/></svg>',
      ),
    });
  const title = page.getByRole("heading", { name: "Crop image", exact: true });
  await expect(title).toBeVisible();
  const modal = page
    .getByRole("dialog", { name: "Crop image", exact: true })
    .locator(":scope > div")
    .filter({ has: title });

  try {
    const image = modal.locator("img");
    await expect(image).toBeVisible();
    await expect
      .poll(() =>
        image.evaluate(
          (element: HTMLImageElement) =>
            element.complete && element.naturalWidth > 0,
        ),
      )
      .toBe(true);
    await captureSurface(page, modal, info, "admin-image-crop-modal");
    await expectQuietHairline(modal);
  } finally {
    await modal.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(title).not.toBeVisible();
    expect(
      adminApi.calls,
      "Opening and cancelling a crop does not mutate the API",
    ).toEqual([]);
  }
});
