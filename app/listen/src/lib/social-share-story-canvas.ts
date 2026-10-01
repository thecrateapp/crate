import type { SharePayload } from "@/lib/social-share";

import type { SocialShareColors } from "./social-share-colors";

export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;

export type CrateStoryComposition = "ranked-stack" | "hero-editorial";

export interface CrateStoryArtwork {
  image: HTMLImageElement;
  position: number;
}

export function resolveCrateStoryComposition(
  payload: SharePayload,
): CrateStoryComposition {
  return payload.kind === "crate" && payload.crateIsOrdered
    ? "ranked-stack"
    : "hero-editorial";
}

export function buildCrateStoryMetadata(payload: SharePayload): string {
  const albumCount = payload.crateAlbums?.length ?? 0;
  const albumLabel = albumCount === 1 ? "1 album" : `${albumCount} albums`;
  const trackLabel =
    payload.crateTrackCount && payload.crateTrackCount > 0
      ? ` · ${payload.crateTrackCount} tracks`
      : "";
  return `${buildInstagramStorySubtitle(payload)} · ${albumLabel}${trackLabel}`;
}

export function drawStoryArtworkBackground(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  colors: SocialShareColors,
) {
  ctx.fillStyle = colors.darkSurface;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.filter = "blur(10px) saturate(1.06)";
  drawCoverImage(ctx, image, -44, -44, width + 88, height + 88, {
    alpha: 0.62,
  });
  ctx.restore();

  ctx.fillStyle = colors.scrimMedium;
  ctx.fillRect(0, 0, width, height);

  const vignette = ctx.createRadialGradient(540, 840, 120, 540, 960, 1120);
  vignette.addColorStop(0, "transparent");
  vignette.addColorStop(0.58, colors.scrimMedium);
  vignette.addColorStop(1, colors.scrimStrong);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  const shade = ctx.createLinearGradient(0, 0, 0, height);
  shade.addColorStop(0, colors.scrimMedium);
  shade.addColorStop(0.68, "transparent");
  shade.addColorStop(1, colors.scrimStrong);
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);
}

export function drawEditorialStoryCard(
  ctx: CanvasRenderingContext2D,
  payload: SharePayload,
  artwork: HTMLImageElement | null,
  logo: HTMLImageElement | null,
  colors: SocialShareColors,
) {
  const cardWidth = 840;
  const cardX = (STORY_WIDTH - cardWidth) / 2;
  const cardY = 468;
  const padding = 28;
  const artSize = cardWidth - padding * 2;
  const artX = cardX + padding;
  const artY = cardY + padding;
  const infoY = artY + artSize;
  const infoHeight = 346;

  ctx.save();
  ctx.shadowColor = colors.scrimStrong;
  ctx.shadowBlur = 84;
  ctx.shadowOffsetY = 42;
  ctx.fillStyle = colors.cardSurface;
  roundedRect(ctx, cardX, cardY, cardWidth, padding + artSize + infoHeight, 18);
  ctx.fill();
  ctx.restore();

  if (artwork) {
    ctx.save();
    roundedRect(ctx, artX, artY, artSize, artSize, 4);
    ctx.clip();
    drawCoverImage(ctx, artwork, artX, artY, artSize, artSize);
    ctx.restore();
  } else {
    drawGeneratedStoryArtwork(ctx, payload, artX, artY, artSize, logo, colors);
  }

  ctx.fillStyle = colors.cardSurface;
  ctx.fillRect(artX, infoY, artSize, infoHeight - padding);

  ctx.textAlign = "center";
  ctx.fillStyle = colors.cardInk;
  ctx.font = "800 76px Poppins, ui-sans-serif, system-ui";
  drawWrappedText(
    ctx,
    payload.title.toUpperCase(),
    STORY_WIDTH / 2,
    infoY + 128,
    cardWidth - 128,
    82,
    2,
  );

  ctx.fillStyle = colors.cardMutedInk;
  ctx.font = "800 43px Poppins, ui-sans-serif, system-ui";
  drawWrappedText(
    ctx,
    buildInstagramStorySubtitle(payload),
    STORY_WIDTH / 2,
    infoY + 266,
    cardWidth - 144,
    52,
    2,
  );
}

export function drawCrateStoryCard(
  ctx: CanvasRenderingContext2D,
  payload: SharePayload,
  artworks: CrateStoryArtwork[],
  logo: HTMLImageElement | null,
  colors: SocialShareColors,
) {
  if (resolveCrateStoryComposition(payload) !== "ranked-stack") {
    drawEditorialStoryCard(
      ctx,
      { ...payload, subtitle: buildCrateStoryMetadata(payload) },
      artworks[0]?.image ?? null,
      logo,
      colors,
    );
    return;
  }

  const cardWidth = 840;
  const cardX = (STORY_WIDTH - cardWidth) / 2;
  const cardY = 468;
  const padding = 28;
  const artSize = cardWidth - padding * 2;
  const artX = cardX + padding;
  const artY = cardY + padding;
  const cardHeight = 1_260;

  ctx.save();
  ctx.shadowColor = colors.scrimStrong;
  ctx.shadowBlur = 84;
  ctx.shadowOffsetY = 42;
  ctx.fillStyle = colors.cardSurface;
  roundedRect(ctx, cardX, cardY, cardWidth, cardHeight, 18);
  ctx.fill();
  ctx.restore();

  const visibleArtworks = artworks.slice(0, 4);
  const tileSize = Math.min(artSize * 0.58, 390);
  const gap = 20;
  const startX = artX + (artSize - tileSize * 2 - gap) / 2;
  const startY = artY + 48;
  if (visibleArtworks.length === 0) {
    drawGeneratedStoryArtwork(ctx, payload, artX, artY, artSize, logo, colors);
  }
  visibleArtworks.forEach((artwork, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = startX + column * (tileSize + gap);
    const y = startY + row * (tileSize + gap);
    ctx.save();
    roundedRect(ctx, x, y, tileSize, tileSize, 10);
    ctx.clip();
    drawCoverImage(ctx, artwork.image, x, y, tileSize, tileSize);
    ctx.restore();

    ctx.fillStyle = colors.accentGlow;
    ctx.font = "800 28px Poppins, ui-sans-serif, system-ui";
    ctx.textAlign = "left";
    const rank = artwork.position + 1;
    ctx.fillText(`RANK #${rank}`, x + 18, y + 42);
    ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
    ctx.font = "800 150px Poppins, ui-sans-serif, system-ui";
    ctx.textAlign = "right";
    ctx.fillText(
      String(rank).padStart(2, "0"),
      x + tileSize - 16,
      y + tileSize - 14,
    );
  });

  ctx.fillStyle = colors.cardSurface;
  ctx.fillRect(artX, artY + artSize * 0.8, artSize, 240);
  ctx.textAlign = "center";
  ctx.fillStyle = colors.cardInk;
  ctx.font = "800 64px Poppins, ui-sans-serif, system-ui";
  drawWrappedText(
    ctx,
    payload.title.toUpperCase(),
    STORY_WIDTH / 2,
    artY + artSize * 0.86,
    cardWidth - 128,
    72,
    2,
  );
  ctx.fillStyle = colors.cardMutedInk;
  ctx.font = "800 36px Poppins, ui-sans-serif, system-ui";
  const albumLabel =
    payload.crateAlbums?.length === 1
      ? "1 ALBUM"
      : `${payload.crateAlbums?.length ?? 0} ALBUMS`;
  const trackLabel =
    payload.crateTrackCount && payload.crateTrackCount > 0
      ? ` · ${payload.crateTrackCount} TRACKS`
      : "";
  drawWrappedText(
    ctx,
    `${albumLabel}${trackLabel} · ${buildInstagramStorySubtitle(
      payload,
    ).toUpperCase()}`,
    STORY_WIDTH / 2,
    artY + artSize * 0.97,
    cardWidth - 144,
    48,
    2,
  );
}

function drawGeneratedStoryArtwork(
  ctx: CanvasRenderingContext2D,
  payload: SharePayload,
  x: number,
  y: number,
  size: number,
  logo: HTMLImageElement | null,
  colors: SocialShareColors,
) {
  ctx.save();
  roundedRect(ctx, x, y, size, size, 4);
  ctx.clip();

  const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
  gradient.addColorStop(0, colors.generatedStart);
  gradient.addColorStop(0.48, colors.generatedMiddle);
  gradient.addColorStop(1, colors.darkSurface);
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, size, size);

  const glow = ctx.createRadialGradient(
    x + size * 0.28,
    y + size * 0.16,
    10,
    x + size * 0.28,
    y + size * 0.16,
    size * 0.86,
  );
  glow.addColorStop(0, colors.accentGlow);
  glow.addColorStop(1, "transparent");
  ctx.fillStyle = glow;
  ctx.fillRect(x, y, size, size);

  if (logo) drawLogoImage(ctx, logo, x + size * 0.34, y + size * 0.16, 240);

  ctx.fillStyle = colors.softText;
  ctx.font = "800 230px Poppins, ui-sans-serif, system-ui";
  ctx.textAlign = "center";
  ctx.fillText(getStoryInitials(payload.title), x + size / 2, y + size * 0.84);

  ctx.restore();
}

export function drawStoryBrand(
  ctx: CanvasRenderingContext2D,
  logo: HTMLImageElement | null,
  colors: SocialShareColors,
) {
  if (logo) drawLogoImage(ctx, logo, 120, 380, 72);
  ctx.textAlign = "left";
  ctx.fillStyle = colors.cardSurface;
  ctx.font = "800 44px Poppins, ui-sans-serif, system-ui";
  ctx.letterSpacing = "10px";
  ctx.fillText("CRATE", 214, 433);
  ctx.letterSpacing = "0px";
}

function buildInstagramStorySubtitle(payload: SharePayload): string {
  const subtitle = payload.subtitle?.trim();
  if (!subtitle) {
    if (payload.kind === "artist") return "Artist";
    return "From Crate";
  }
  if (payload.kind === "track") return `Track by ${subtitle}`;
  if (payload.kind === "album") return `Album by ${subtitle}`;
  if (payload.kind === "playlist") return `Playlist by ${subtitle}`;
  return subtitle;
}

function getStoryInitials(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

function drawLogoImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
) {
  const height = width * (image.naturalHeight / image.naturalWidth);
  ctx.drawImage(image, x, y, width, height);
}

export function drawStoryBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  colors: SocialShareColors,
) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, colors.storyStart);
  gradient.addColorStop(0.44, colors.storyMiddle);
  gradient.addColorStop(1, colors.darkSurface);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const cyan = ctx.createRadialGradient(170, 120, 20, 170, 120, 900);
  cyan.addColorStop(0, colors.accentGlow);
  cyan.addColorStop(1, "transparent");
  ctx.fillStyle = cyan;
  ctx.fillRect(0, 0, width, height);

  const lime = ctx.createRadialGradient(900, 1780, 20, 900, 1780, 760);
  lime.addColorStop(0, colors.secondaryAccent);
  lime.addColorStop(1, "transparent");
  ctx.fillStyle = lime;
  ctx.fillRect(0, 0, width, height);
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  options: { alpha?: number } = {},
) {
  const scale = Math.max(
    width / image.naturalWidth,
    height / image.naturalHeight,
  );
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = (image.naturalWidth - sourceWidth) / 2;
  const sourceY = (image.naturalHeight - sourceHeight) / 2;
  ctx.save();
  ctx.globalAlpha = options.alpha ?? 1;
  ctx.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height,
  );
  ctx.restore();
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines = 3,
) {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth || !line) {
      line = test;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines || words.join(" ") !== visible.join(" ")) {
    const last = visible[visible.length - 1] || "";
    visible[visible.length - 1] = `${last.replace(/[.,;:!?-]+$/, "")}...`;
  }
  visible.forEach((value, index) => {
    ctx.fillText(value, x, y + index * lineHeight);
  });
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
