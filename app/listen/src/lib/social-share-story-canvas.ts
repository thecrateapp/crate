import type {
  ShareCardLabels,
  SharePayload,
  DiggingShareData,
} from "@/lib/social-share";

import type { SocialShareColors } from "./social-share-colors";

export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;
export const SQUARE_POST_SIZE = 1080;
export const STORY_SAFE_TOP = 250;
export const STORY_SAFE_BOTTOM = 280;
export const CRATE_CARD_MAX_ALBUMS = 5;
export const CRATE_STORY_MAX_ALBUMS = 10;
export const CRATE_STORY_STYLES = ["bento", "podium", "chart"] as const;
export type CrateStoryStyle = (typeof CRATE_STORY_STYLES)[number];
export const DEFAULT_CRATE_STORY_STYLE: CrateStoryStyle = "bento";

const FONT_STACK = "Poppins, ui-sans-serif, system-ui";
const CARD_MARGIN = 72;

export type CrateStoryComposition = "ranked-stack" | "coverflow-fan";

export interface CrateStoryArtwork {
  image: HTMLImageElement | null;
  position: number;
  name?: string;
  artistName?: string;
}

export function resolveCrateStoryComposition(
  payload: SharePayload,
): CrateStoryComposition {
  return payload.kind === "crate" && payload.crateIsOrdered
    ? "ranked-stack"
    : "coverflow-fan";
}

export function crateAlbumCount(payload: SharePayload): number {
  return payload.crateAlbumCount ?? payload.crateAlbums?.length ?? 0;
}

export function buildCrateStoryByline(
  payload: SharePayload,
  labels?: ShareCardLabels,
): string {
  if (labels?.subtitle) return labels.subtitle;
  const owner =
    payload.crateOwnerInstagram?.trim() ||
    payload.crateOwnerName?.trim() ||
    payload.subtitle?.trim();
  return owner ? `A selected Crate by ${owner}` : "Crate";
}

export function buildCrateStoryMetadata(
  payload: SharePayload,
  labels?: ShareCardLabels,
): string {
  if (labels?.metadata) return labels.metadata;
  const albumCount = crateAlbumCount(payload);
  const albumLabel = albumCount === 1 ? "1 album" : `${albumCount} albums`;
  const trackLabel =
    payload.crateTrackCount && payload.crateTrackCount > 0
      ? ` · ${
          payload.crateTrackCount === 1
            ? "1 track"
            : `${payload.crateTrackCount} tracks`
        }`
      : "";
  return `${albumLabel}${trackLabel}`;
}

export function formatShareDisplayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
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

export function drawCrateArtworkBackground(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  width: number,
  height: number,
  colors: SocialShareColors,
) {
  if (!image) {
    drawStoryBackground(ctx, width, height, colors);
  } else {
    ctx.fillStyle = colors.darkSurface;
    ctx.fillRect(0, 0, width, height);
    const blurred = createBlurredArtwork(image, width, height);
    ctx.save();
    ctx.globalAlpha = 0.9;
    if (blurred) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(blurred, -80, -80, width + 160, height + 160);
    } else {
      drawCoverImage(ctx, image, 0, 0, width, height);
    }
    ctx.restore();
  }

  ctx.fillStyle = colors.scrimMedium;
  ctx.fillRect(0, 0, width, height);

  const shade = ctx.createLinearGradient(0, 0, 0, height);
  shade.addColorStop(0, colors.scrimStrong);
  shade.addColorStop(0.3, "transparent");
  shade.addColorStop(0.55, colors.scrimMedium);
  shade.addColorStop(1, colors.scrimStrong);
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(
    width / 2,
    height * 0.36,
    40,
    width / 2,
    height * 0.36,
    width * 0.9,
  );
  glow.addColorStop(0, colors.accentGlow);
  glow.addColorStop(1, "transparent");
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function createBlurredArtwork(
  image: HTMLImageElement,
  width: number,
  height: number,
): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const small = document.createElement("canvas");
  small.width = 18;
  small.height = Math.max(18, Math.round((18 * height) / width));
  const smallCtx = small.getContext("2d");
  if (!smallCtx) return null;
  smallCtx.imageSmoothingEnabled = true;
  smallCtx.imageSmoothingQuality = "high";
  drawCoverImage(smallCtx, image, 0, 0, small.width, small.height);

  const medium = document.createElement("canvas");
  medium.width = small.width * 6;
  medium.height = small.height * 6;
  const mediumCtx = medium.getContext("2d");
  if (!mediumCtx) return small;
  mediumCtx.imageSmoothingEnabled = true;
  mediumCtx.imageSmoothingQuality = "high";
  mediumCtx.drawImage(small, 0, 0, medium.width, medium.height);
  return medium;
}

export function drawEditorialStoryCard(
  ctx: CanvasRenderingContext2D,
  payload: SharePayload,
  artwork: HTMLImageElement | null,
  logo: HTMLImageElement | null,
  colors: SocialShareColors,
  labels?: ShareCardLabels,
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
  ctx.font = `800 76px ${FONT_STACK}`;
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
  ctx.font = `800 43px ${FONT_STACK}`;
  drawWrappedText(
    ctx,
    buildInstagramStorySubtitle(payload, labels),
    STORY_WIDTH / 2,
    infoY + 266,
    cardWidth - 144,
    52,
    2,
  );
}

export function resolveCrateStoryStyle(payload: SharePayload): CrateStoryStyle {
  const style = payload.crateStoryStyle;
  return style && CRATE_STORY_STYLES.includes(style)
    ? style
    : DEFAULT_CRATE_STORY_STYLE;
}

const STORY_CONTENT_TOP = STORY_SAFE_TOP + 150;
const STORY_CONTENT_BOTTOM = STORY_HEIGHT - STORY_SAFE_BOTTOM;
const STORY_TEXT_SIZES = { titleSize: 84, bylineSize: 40, metaSize: 34 };

export function drawCrateStoryCard(
  ctx: CanvasRenderingContext2D,
  payload: SharePayload,
  artworks: CrateStoryArtwork[],
  logo: HTMLImageElement | null,
  colors: SocialShareColors,
  labels?: ShareCardLabels,
) {
  const albums = artworks.slice(0, CRATE_STORY_MAX_ALBUMS);
  drawBrandRow(ctx, logo, colors, {
    x: CARD_MARGIN,
    y: STORY_SAFE_TOP + 24,
    width: STORY_WIDTH - CARD_MARGIN * 2,
    logoSize: 64,
    fontSize: 40,
  });

  if (albums.length === 0) {
    drawGeneratedStoryArtwork(ctx, payload, 240, 420, 600, logo, colors);
    drawStoryTitle(ctx, payload, colors, labels, 1092);
    return;
  }

  const ranked = payload.crateIsOrdered === true;
  const style = resolveCrateStoryStyle(payload);
  if (style === "chart") {
    drawChartStory(ctx, albums, payload, colors, labels, ranked);
  } else if (style === "podium") {
    drawPodiumStory(ctx, albums, payload, colors, labels, ranked);
  } else {
    drawBentoStory(ctx, albums, payload, colors, labels, ranked);
  }
}

function drawStoryTitle(
  ctx: CanvasRenderingContext2D,
  payload: SharePayload,
  colors: SocialShareColors,
  labels: ShareCardLabels | undefined,
  top: number,
  options: { x?: number; maxWidth?: number; titleSize?: number } = {},
): number {
  return drawCrateTextBlock(ctx, payload, colors, labels, {
    x: options.x ?? CARD_MARGIN,
    align: "left",
    maxWidth: options.maxWidth ?? STORY_WIDTH - CARD_MARGIN * 2,
    top,
    bottom: STORY_CONTENT_BOTTOM,
    ...STORY_TEXT_SIZES,
    titleSize: options.titleSize ?? STORY_TEXT_SIZES.titleSize,
    urlSize: 0,
  });
}

function drawStoryTile(
  ctx: CanvasRenderingContext2D,
  album: CrateStoryArtwork,
  x: number,
  y: number,
  size: number,
  payload: SharePayload,
  colors: SocialShareColors,
  showRank: boolean,
) {
  const radius = Math.max(10, Math.round(size * 0.05));
  drawShadowedArtwork(ctx, album, x, y, size, radius, payload, colors);
  if (showRank) {
    drawRankNumeral(ctx, formatRank(album.position), {
      x,
      y,
      width: size,
      height: size,
      radius,
    });
  }
}

function drawRankNumeral(
  ctx: CanvasRenderingContext2D,
  label: string,
  box: { x: number; y: number; width: number; height: number; radius: number },
) {
  const fontSize = Math.round(box.height * 0.72);
  ctx.save();
  roundedRect(ctx, box.x, box.y, box.width, box.height, box.radius);
  ctx.clip();
  ctx.font = `900 ${fontSize}px ${FONT_STACK}`;
  ctx.letterSpacing = `${Math.round(fontSize * -0.07)}px`;
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = Math.round(fontSize * 0.1);
  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.fillText(
    label,
    box.x + box.width - fontSize * 0.01,
    box.y + box.height + fontSize * 0.03,
  );
  ctx.restore();
}

function drawPodiumStory(
  ctx: CanvasRenderingContext2D,
  albums: CrateStoryArtwork[],
  payload: SharePayload,
  colors: SocialShareColors,
  labels: ShareCardLabels | undefined,
  ranked: boolean,
) {
  const [hero, ...rest] = albums;
  if (!hero) return;
  const heroSize = 500;
  const heroX = STORY_WIDTH - CARD_MARGIN - heroSize;
  const heroY = STORY_CONTENT_TOP;
  drawStoryTile(ctx, hero, heroX, heroY, heroSize, payload, colors, ranked);
  drawHeroCaption(ctx, hero, colors, {
    x: CARD_MARGIN,
    top: heroY,
    width: heroX - CARD_MARGIN - 40,
  });

  let cursor = heroY + heroSize;
  const rows = [
    {
      albums: rest.slice(0, 3),
      columns: 3,
      gap: 28,
      spacing: 32,
    },
    {
      albums: rest.slice(3, 9),
      columns: 6,
      gap: 16,
      spacing: 22,
    },
  ];
  rows.forEach(({ albums: row, columns, gap, spacing }) => {
    if (row.length === 0) return;
    const size =
      (STORY_WIDTH - CARD_MARGIN * 2 - gap * (columns - 1)) / columns;
    cursor += spacing;
    row.forEach((album, index) => {
      drawStoryTile(
        ctx,
        album,
        CARD_MARGIN + index * (size + gap),
        cursor,
        size,
        payload,
        colors,
        ranked,
      );
    });
    cursor += size;
  });

  drawStoryTitle(ctx, payload, colors, labels, cursor + 52);
}

function drawHeroCaption(
  ctx: CanvasRenderingContext2D,
  hero: CrateStoryArtwork,
  colors: SocialShareColors,
  layout: { x: number; top: number; width: number },
) {
  const { x, top, width } = layout;
  if (!hero.name) return;
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = colors.cardSurface;
  ctx.font = `800 42px ${FONT_STACK}`;
  const nameBottom = drawWrappedText(ctx, hero.name, x, top + 52, width, 50, 3);
  if (hero.artistName) {
    ctx.fillStyle = colors.cardMutedInk;
    ctx.font = `600 32px ${FONT_STACK}`;
    drawWrappedText(ctx, hero.artistName, x, nameBottom + 44, width, 40, 2);
  }
  ctx.restore();
}

const BENTO_COLUMNS = 4;
const BENTO_SLOTS: ReadonlyArray<[number, number]> = [
  [2, 0],
  [3, 0],
  [2, 1],
  [3, 1],
  [0, 2],
  [1, 2],
  [2, 2],
  [3, 2],
  [0, 3],
];

function drawBentoStory(
  ctx: CanvasRenderingContext2D,
  albums: CrateStoryArtwork[],
  payload: SharePayload,
  colors: SocialShareColors,
  labels: ShareCardLabels | undefined,
  ranked: boolean,
) {
  const margin = 60;
  const gap = 16;
  const cell =
    (STORY_WIDTH - margin * 2 - gap * (BENTO_COLUMNS - 1)) / BENTO_COLUMNS;
  const top = STORY_CONTENT_TOP + 10;
  const cellX = (column: number) => margin + column * (cell + gap);
  const cellY = (row: number) => top + row * (cell + gap);
  const [hero, ...rest] = albums;
  if (!hero) return;
  const heroSize = cell * 2 + gap;
  drawStoryTile(
    ctx,
    hero,
    cellX(0),
    cellY(0),
    heroSize,
    payload,
    colors,
    ranked,
  );

  let lastRow = 1;
  let lastColumn = 1;
  rest.slice(0, BENTO_SLOTS.length).forEach((album, index) => {
    const slot = BENTO_SLOTS[index];
    if (!slot) return;
    const [column, row] = slot;
    drawStoryTile(
      ctx,
      album,
      cellX(column),
      cellY(row),
      cell,
      payload,
      colors,
      ranked,
    );
    if (row > lastRow || (row === lastRow && column > lastColumn)) {
      lastRow = row;
      lastColumn = column;
    }
  });

  const freeColumns = lastRow >= 2 ? BENTO_COLUMNS - 1 - lastColumn : 0;
  const gridBottom = cellY(lastRow) + cell;
  let contentBottom: number;
  if (freeColumns >= 2) {
    const x = cellX(lastColumn + 1) + 8;
    const titleBottom = drawStoryTitle(
      ctx,
      payload,
      colors,
      labels,
      gridBottom - 190,
      { x, maxWidth: STORY_WIDTH - margin - x, titleSize: 72 },
    );
    contentBottom = Math.max(gridBottom, titleBottom);
  } else {
    contentBottom = drawStoryTitle(
      ctx,
      payload,
      colors,
      labels,
      gridBottom + 56,
    );
  }
  drawCompactAlbumList(ctx, albums, colors, ranked, {
    x: margin,
    top: contentBottom + 64,
    width: STORY_WIDTH - margin * 2,
  });
}

function drawCompactAlbumList(
  ctx: CanvasRenderingContext2D,
  albums: CrateStoryArtwork[],
  colors: SocialShareColors,
  ranked: boolean,
  layout: { x: number; top: number; width: number },
) {
  const available = STORY_CONTENT_BOTTOM - layout.top;
  const neededRows = Math.ceil(albums.length / 2);
  const lineHeight = Math.min(48, Math.floor(available / neededRows));
  const rows =
    lineHeight >= 38
      ? neededRows
      : Math.min(neededRows, Math.floor(available / 38));
  if (rows < 3) return;
  const fontSize = Math.round(Math.max(lineHeight, 38) * 0.56);
  const columnGap = 40;
  const columnWidth = (layout.width - columnGap) / 2;
  const rankWidth = ranked ? 64 : 0;
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  albums.slice(0, rows * 2).forEach((album, index) => {
    const column = Math.floor(index / rows);
    const row = index % rows;
    const x = layout.x + column * (columnWidth + columnGap);
    const y = layout.top + row * Math.max(lineHeight, 38) + fontSize;
    if (ranked) {
      ctx.fillStyle = colors.accent;
      ctx.font = `800 ${fontSize}px ${FONT_STACK}`;
      ctx.fillText(formatRank(album.position), x, y);
    }
    const textX = x + rankWidth;
    const textWidth = columnWidth - rankWidth;
    ctx.fillStyle = colors.cardSurface;
    ctx.font = `700 ${fontSize}px ${FONT_STACK}`;
    const title = truncateToWidth(ctx, album.name ?? "", textWidth);
    ctx.fillText(title, textX, y);
    const titleWidth = ctx.measureText(title).width;
    const artistWidth = textWidth - titleWidth - 16;
    if (album.artistName && artistWidth > 80) {
      ctx.fillStyle = colors.cardMutedInk;
      ctx.font = `500 ${fontSize}px ${FONT_STACK}`;
      ctx.fillText(
        truncateToWidth(ctx, album.artistName, artistWidth),
        textX + titleWidth + 16,
        y,
      );
    }
  });
  ctx.restore();
}

function drawChartStory(
  ctx: CanvasRenderingContext2D,
  albums: CrateStoryArtwork[],
  payload: SharePayload,
  colors: SocialShareColors,
  labels: ShareCardLabels | undefined,
  ranked: boolean,
) {
  const titleBottom = drawStoryTitle(
    ctx,
    payload,
    colors,
    labels,
    STORY_CONTENT_TOP - 6,
    { titleSize: 76 },
  );
  const [hero, ...rest] = albums;
  if (!hero) return;
  const left = CARD_MARGIN;
  const width = STORY_WIDTH - CARD_MARGIN * 2;
  let y = titleBottom + 44;

  const rowGap = 10;
  const heroGap = 18;
  const heroHeight = 200;
  const rowHeight = Math.max(
    56,
    Math.min(
      80,
      Math.floor(
        (STORY_CONTENT_BOTTOM - y - heroHeight - heroGap - rowGap * 8) / 9,
      ),
    ),
  );

  ctx.save();
  roundedRect(ctx, left, y, width, heroHeight, 24);
  ctx.fillStyle = colors.accent;
  ctx.globalAlpha = 0.12;
  ctx.fill();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  drawChartRow(ctx, hero, colors, payload, {
    box: { x: left, y, width, height: heroHeight, radius: 24 },
    coverInset: 20,
    titleSize: 44,
    artistSize: 30,
    ranked,
  });
  y += heroHeight + heroGap;

  rest.forEach((album) => {
    drawChartRow(ctx, album, colors, payload, {
      box: { x: left, y, width, height: rowHeight, radius: 12 },
      coverInset: 0,
      titleSize: Math.round(rowHeight * 0.4),
      artistSize: Math.round(rowHeight * 0.3),
      ranked,
    });
    y += rowHeight + rowGap;
  });
}

function drawChartRow(
  ctx: CanvasRenderingContext2D,
  album: CrateStoryArtwork,
  colors: SocialShareColors,
  payload: SharePayload,
  layout: {
    box: {
      x: number;
      y: number;
      width: number;
      height: number;
      radius: number;
    };
    coverInset: number;
    titleSize: number;
    artistSize: number;
    ranked: boolean;
  },
) {
  const { box, coverInset, titleSize, artistSize, ranked } = layout;
  if (ranked) drawRankNumeral(ctx, formatRank(album.position), box);
  const coverSize = box.height - coverInset * 2;
  const coverX = box.x + coverInset;
  const coverY = box.y + coverInset;
  drawShadowedArtwork(
    ctx,
    album,
    coverX,
    coverY,
    coverSize,
    Math.round(coverSize * 0.12),
    payload,
    colors,
  );
  const centerY = box.y + box.height / 2;
  const textX = coverX + coverSize + 26;
  const numeralReserve = ranked ? box.height * 1.25 : 24;
  const textWidth = box.x + box.width - numeralReserve - textX;
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const hasArtist = Boolean(album.artistName);
  const titleBaseline = hasArtist
    ? centerY - artistSize * 0.15
    : centerY + titleSize * 0.35;
  ctx.fillStyle = colors.cardSurface;
  ctx.font = `700 ${titleSize}px ${FONT_STACK}`;
  ctx.fillText(
    truncateToWidth(ctx, album.name ?? "", textWidth),
    textX,
    titleBaseline,
  );
  if (hasArtist) {
    ctx.fillStyle = colors.cardMutedInk;
    ctx.font = `500 ${artistSize}px ${FONT_STACK}`;
    ctx.fillText(
      truncateToWidth(ctx, album.artistName ?? "", textWidth),
      textX,
      titleBaseline + artistSize * 1.35,
    );
  }
  ctx.restore();
}

export function drawCrateSquareCard(
  ctx: CanvasRenderingContext2D,
  payload: SharePayload,
  artworks: CrateStoryArtwork[],
  logo: HTMLImageElement | null,
  colors: SocialShareColors,
  labels?: ShareCardLabels,
) {
  const albums = artworks.slice(0, CRATE_CARD_MAX_ALBUMS);
  const composition = resolveCrateStoryComposition(payload);
  const margin = 64;
  drawBrandRow(ctx, logo, colors, {
    x: margin,
    y: 52,
    width: SQUARE_POST_SIZE - margin * 2,
    logoSize: 50,
    fontSize: 32,
    kicker: labels?.kicker,
  });

  let coversBottom: number;
  if (albums.length === 0) {
    drawGeneratedStoryArtwork(ctx, payload, 330, 150, 420, logo, colors);
    coversBottom = 570;
  } else if (composition === "ranked-stack") {
    coversBottom = drawRankedSquareCovers(ctx, albums, colors, margin);
  } else {
    coversBottom = drawCoverflowFan(ctx, albums, colors, {
      cx: SQUARE_POST_SIZE / 2,
      cy: 356,
      scale: 0.76,
      payload,
    });
  }

  const ranked = composition === "ranked-stack";
  drawCrateTextBlock(ctx, payload, colors, labels, {
    x: ranked ? margin : SQUARE_POST_SIZE / 2,
    align: ranked ? "left" : "center",
    maxWidth: SQUARE_POST_SIZE - margin * 2,
    top: coversBottom + (ranked ? 62 : 44),
    bottom: SQUARE_POST_SIZE - 52,
    titleSize: 64,
    bylineSize: 32,
    metaSize: 28,
    urlSize: 26,
  });
}

export function drawSquareEditorialCard(
  ctx: CanvasRenderingContext2D,
  payload: SharePayload,
  artwork: HTMLImageElement | null,
  logo: HTMLImageElement | null,
  colors: SocialShareColors,
  labels?: ShareCardLabels,
) {
  const margin = 64;
  drawBrandRow(ctx, logo, colors, {
    x: margin,
    y: 52,
    width: SQUARE_POST_SIZE - margin * 2,
    logoSize: 50,
    fontSize: 32,
    kicker: labels?.kicker,
  });

  const size = 520;
  const x = (SQUARE_POST_SIZE - size) / 2;
  const y = 140;
  if (artwork) {
    drawShadowedCover(ctx, artwork, x, y, size, 14, colors);
  } else {
    drawGeneratedStoryArtwork(ctx, payload, x, y, size, logo, colors);
  }

  drawCrateTextBlock(
    ctx,
    payload,
    colors,
    { ...labels, subtitle: buildInstagramStorySubtitle(payload, labels) },
    {
      x: SQUARE_POST_SIZE / 2,
      align: "center",
      maxWidth: SQUARE_POST_SIZE - margin * 2,
      top: y + size + 58,
      bottom: SQUARE_POST_SIZE - 52,
      titleSize: 60,
      bylineSize: 32,
      metaSize: 0,
      urlSize: 26,
    },
  );
}

function drawRankedSquareCovers(
  ctx: CanvasRenderingContext2D,
  albums: CrateStoryArtwork[],
  colors: SocialShareColors,
  margin: number,
): number {
  const [hero, ...rest] = albums;
  const top = 140;
  const heroSize = 430;
  if (!hero) return top + heroSize;
  const gap = 18;
  const tileSize = (heroSize - gap) / 2;
  const blockWidth =
    rest.length === 0
      ? heroSize
      : heroSize + gap + (rest.length > 1 ? tileSize * 2 + gap : tileSize);
  const heroX = margin + (SQUARE_POST_SIZE - margin * 2 - blockWidth) / 2;
  drawShadowedArtwork(ctx, hero, heroX, top, heroSize, 14, null, colors);
  drawRankChip(
    ctx,
    formatRank(hero.position),
    heroX + 16,
    top + heroSize - 16,
    72,
    colors,
  );

  rest.forEach((album, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = heroX + heroSize + gap + column * (tileSize + gap);
    const y = top + row * (tileSize + gap);
    drawShadowedArtwork(ctx, album, x, y, tileSize, 10, null, colors);
    drawRankChip(
      ctx,
      formatRank(album.position),
      x + 10,
      y + tileSize - 10,
      34,
      colors,
    );
  });
  return top + heroSize;
}

interface FanSlot {
  near: number;
  size: number;
  squeeze: number;
  side: -1 | 0 | 1;
  shade: number;
}

const FAN_SIZE = 560;
const FAN_REFLECTION_RATIO = 0.14;

const FAN_SLOTS: FanSlot[] = [
  { near: 0, size: FAN_SIZE, squeeze: 1, side: 0, shade: 0 },
  { near: 150, size: 480, squeeze: 0.62, side: 1, shade: 0.18 },
  { near: 150, size: 480, squeeze: 0.62, side: -1, shade: 0.18 },
  { near: 300, size: 410, squeeze: 0.52, side: 1, shade: 0.36 },
  { near: 300, size: 410, squeeze: 0.52, side: -1, shade: 0.36 },
];

function drawCoverflowFan(
  ctx: CanvasRenderingContext2D,
  albums: CrateStoryArtwork[],
  colors: SocialShareColors,
  options: { cx: number; cy: number; scale: number; payload: SharePayload },
): number {
  const { cx, cy, payload } = options;
  const scale = options.scale * (albums.length === 1 ? 1.12 : 1);
  const slots = FAN_SLOTS.slice(0, albums.length);
  const bounds = slots.map(fanSlotBounds);
  const minX = Math.min(...bounds.map((value) => value.left));
  const maxX = Math.max(...bounds.map((value) => value.right));
  const centerX = cx - ((minX + maxX) / 2) * scale;

  for (let index = slots.length - 1; index >= 0; index -= 1) {
    const slot = slots[index];
    const album = albums[index];
    if (!slot || !album) continue;
    const size = slot.size * scale;
    if (slot.side === 0) {
      const x = centerX - size / 2;
      const y = cy - size / 2;
      if (album.image) {
        drawCoverReflection(ctx, album.image, x, y + size + 6, size, 0.2);
      }
      drawShadowedArtwork(ctx, album, x, y, size, 14 * scale, payload, colors);
      continue;
    }
    drawPerspectiveArtwork(ctx, album, {
      nearX: centerX + slot.side * slot.near * scale,
      cy,
      size,
      width: size * slot.squeeze,
      farScale: 0.84,
      side: slot.side,
      shade: slot.shade,
      colors,
      payload,
    });
  }
  return cy + (FAN_SIZE * scale) / 2 + FAN_SIZE * scale * FAN_REFLECTION_RATIO;
}

function fanSlotBounds(slot: FanSlot): { left: number; right: number } {
  if (slot.side === 0) return { left: -slot.size / 2, right: slot.size / 2 };
  const width = slot.size * slot.squeeze;
  return slot.side > 0
    ? { left: slot.near, right: slot.near + width }
    : { left: -slot.near - width, right: -slot.near };
}

function drawPerspectiveArtwork(
  ctx: CanvasRenderingContext2D,
  album: CrateStoryArtwork,
  options: {
    nearX: number;
    cy: number;
    size: number;
    width: number;
    farScale: number;
    side: -1 | 1;
    shade: number;
    colors: SocialShareColors;
    payload: SharePayload;
  },
) {
  const { nearX, cy, size, width, farScale, side, shade, colors } = options;
  const farX = nearX + side * width;
  const nearHalf = size / 2;
  const farHalf = (size * farScale) / 2;

  const trapezoid = () => {
    ctx.beginPath();
    ctx.moveTo(nearX, cy - nearHalf);
    ctx.lineTo(farX, cy - farHalf);
    ctx.lineTo(farX, cy + farHalf);
    ctx.lineTo(nearX, cy + nearHalf);
    ctx.closePath();
  };

  ctx.save();
  ctx.shadowColor = colors.scrimStrong;
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 34;
  ctx.fillStyle = colors.darkSurface;
  trapezoid();
  ctx.fill();
  ctx.restore();

  const source = album.image ?? createGeneratedTile(options.payload, colors);
  if (source) {
    const sourceWidth =
      source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const sourceHeight =
      source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    const crop = Math.min(sourceWidth, sourceHeight);
    const sourceX = (sourceWidth - crop) / 2;
    const sourceY = (sourceHeight - crop) / 2;
    const strips = Math.max(24, Math.ceil(width / 2));
    const stripWidth = width / strips;
    ctx.save();
    trapezoid();
    ctx.clip();
    for (let index = 0; index < strips; index += 1) {
      const distance = (index + 0.5) / strips;
      const half = nearHalf + (farHalf - nearHalf) * distance;
      const sourceT = side > 0 ? index / strips : 1 - (index + 1) / strips;
      const destX =
        side > 0
          ? nearX + index * stripWidth
          : nearX - (index + 1) * stripWidth;
      ctx.drawImage(
        source,
        sourceX + sourceT * crop,
        sourceY,
        crop / strips,
        crop,
        destX - 0.5,
        cy - half,
        stripWidth + 1,
        half * 2,
      );
    }
    ctx.restore();
  }

  ctx.save();
  trapezoid();
  const shadeGradient = ctx.createLinearGradient(nearX, 0, farX, 0);
  shadeGradient.addColorStop(0, `rgba(0, 0, 0, ${shade * 0.6})`);
  shadeGradient.addColorStop(
    1,
    `rgba(0, 0, 0, ${Math.min(0.8, shade + 0.18)})`,
  );
  ctx.fillStyle = shadeGradient;
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function createGeneratedTile(
  payload: SharePayload,
  colors: SocialShareColors,
): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const tileCtx = canvas.getContext("2d");
  if (!tileCtx) return null;
  drawGeneratedStoryArtwork(tileCtx, payload, 0, 0, 256, null, colors);
  return canvas;
}

function drawCoverReflection(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  size: number,
  alpha: number,
) {
  if (typeof document === "undefined") return;
  const height = Math.round(size * FAN_REFLECTION_RATIO);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(size);
  canvas.height = height;
  const reflectionCtx = canvas.getContext("2d");
  if (!reflectionCtx) return;
  reflectionCtx.save();
  reflectionCtx.translate(0, size);
  reflectionCtx.scale(1, -1);
  drawCoverImage(reflectionCtx, image, 0, 0, size, size);
  reflectionCtx.restore();
  reflectionCtx.globalCompositeOperation = "destination-in";
  const fade = reflectionCtx.createLinearGradient(0, 0, 0, height);
  fade.addColorStop(0, "rgba(0, 0, 0, 1)");
  fade.addColorStop(1, "rgba(0, 0, 0, 0)");
  reflectionCtx.fillStyle = fade;
  reflectionCtx.fillRect(0, 0, canvas.width, height);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(canvas, x, y);
  ctx.restore();
}

function drawShadowedArtwork(
  ctx: CanvasRenderingContext2D,
  album: CrateStoryArtwork,
  x: number,
  y: number,
  size: number,
  radius: number,
  payload: SharePayload | null,
  colors: SocialShareColors,
) {
  if (album.image) {
    drawShadowedCover(ctx, album.image, x, y, size, radius, colors);
    return;
  }
  ctx.save();
  ctx.shadowColor = colors.scrimStrong;
  ctx.shadowBlur = 56;
  ctx.shadowOffsetY = 28;
  ctx.fillStyle = colors.darkSurface;
  roundedRect(ctx, x, y, size, size, radius);
  ctx.fill();
  ctx.restore();
  drawGeneratedStoryArtwork(
    ctx,
    payload ?? { kind: "album", title: album.name ?? "Crate", url: "" },
    x,
    y,
    size,
    null,
    colors,
    album.name,
  );
}

function drawShadowedCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  size: number,
  radius: number,
  colors: SocialShareColors,
) {
  ctx.save();
  ctx.shadowColor = colors.scrimStrong;
  ctx.shadowBlur = 64;
  ctx.shadowOffsetY = 32;
  ctx.fillStyle = colors.darkSurface;
  roundedRect(ctx, x, y, size, size, radius);
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundedRect(ctx, x, y, size, size, radius);
  ctx.clip();
  drawCoverImage(ctx, image, x, y, size, size);
  ctx.restore();

  ctx.save();
  roundedRect(ctx, x + 1, y + 1, size - 2, size - 2, radius);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawRankChip(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  bottom: number,
  fontSize: number,
  colors: SocialShareColors,
) {
  ctx.save();
  ctx.font = `800 ${fontSize}px ${FONT_STACK}`;
  const paddingX = fontSize * 0.36;
  const height = fontSize * 1.34;
  const width = ctx.measureText(label).width + paddingX * 2;
  const y = bottom - height;
  ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
  roundedRect(ctx, x, y, width, height, fontSize * 0.28);
  ctx.fill();
  ctx.fillStyle = colors.accent;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + paddingX, y + height / 2 + fontSize * 0.06);
  ctx.restore();
}

function formatRank(position: number): string {
  return String(Math.max(1, position + 1)).padStart(2, "0");
}

function drawBrandRow(
  ctx: CanvasRenderingContext2D,
  logo: HTMLImageElement | null,
  colors: SocialShareColors,
  options: {
    x: number;
    y: number;
    width: number;
    logoSize: number;
    fontSize: number;
    kicker?: string;
  },
) {
  const { x, y, width, logoSize, fontSize, kicker } = options;
  const centerY = y + logoSize / 2;
  let textX = x;
  if (logo) {
    drawLogoImage(ctx, logo, x, y, logoSize);
    textX = x + logoSize * 1.32;
  }
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = colors.cardSurface;
  ctx.font = `800 ${fontSize}px ${FONT_STACK}`;
  ctx.letterSpacing = `${Math.round(fontSize * 0.22)}px`;
  ctx.fillText("CRATE", textX, centerY + fontSize * 0.06);
  ctx.letterSpacing = "0px";

  if (kicker) {
    const kickerSize = Math.round(fontSize * 0.7);
    ctx.font = `800 ${kickerSize}px ${FONT_STACK}`;
    ctx.letterSpacing = `${Math.round(kickerSize * 0.14)}px`;
    const label = kicker.toUpperCase();
    const paddingX = kickerSize * 0.9;
    const pillHeight = kickerSize * 2.1;
    const pillWidth = Math.min(
      width * 0.55,
      ctx.measureText(label).width + paddingX * 2,
    );
    const pillX = x + width - pillWidth;
    const pillY = centerY - pillHeight / 2;
    ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
    roundedRect(ctx, pillX, pillY, pillWidth, pillHeight, pillHeight / 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = colors.cardSurface;
    ctx.textAlign = "center";
    ctx.fillText(
      truncateToWidth(ctx, label, pillWidth - paddingX * 2),
      pillX + pillWidth / 2,
      centerY + kickerSize * 0.06,
    );
    ctx.letterSpacing = "0px";
  }
  ctx.restore();
}

function drawCrateTextBlock(
  ctx: CanvasRenderingContext2D,
  payload: SharePayload,
  colors: SocialShareColors,
  labels: ShareCardLabels | undefined,
  layout: {
    x: number;
    align: CanvasTextAlign;
    maxWidth: number;
    top: number;
    bottom: number;
    titleSize: number;
    bylineSize: number;
    metaSize: number;
    urlSize: number;
  },
): number {
  const { x, align, maxWidth, top, bottom } = layout;
  ctx.save();
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";

  const urlHeight = Math.round(
    layout.urlSize * (labels?.cta?.trim() ? 3.1 : 2.3),
  );
  const urlTop = bottom - urlHeight;

  const titleSize = fitWrappedFont(
    ctx,
    payload.title,
    maxWidth,
    layout.titleSize,
    Math.round(layout.titleSize * 0.7),
    2,
  );
  const titleLineHeight = Math.round(titleSize * 1.08);
  ctx.fillStyle = colors.cardSurface;
  ctx.font = `800 ${titleSize}px ${FONT_STACK}`;
  let cursor = drawWrappedText(
    ctx,
    payload.title,
    x,
    top + titleSize * 0.82,
    maxWidth,
    titleLineHeight,
    2,
  );

  const byline =
    payload.kind === "crate"
      ? buildCrateStoryByline(payload, labels)
      : labels?.subtitle;
  if (byline && layout.bylineSize > 0) {
    cursor += Math.round(layout.bylineSize * 1.55);
    ctx.fillStyle = colors.accent;
    ctx.font = `700 ${layout.bylineSize}px ${FONT_STACK}`;
    ctx.fillText(truncateToWidth(ctx, byline, maxWidth), x, cursor);
  }

  if (payload.kind === "crate" && layout.metaSize > 0) {
    cursor += Math.round(layout.metaSize * 1.5);
    ctx.fillStyle = colors.cardMutedInk;
    ctx.font = `600 ${layout.metaSize}px ${FONT_STACK}`;
    ctx.fillText(
      truncateToWidth(ctx, buildCrateStoryMetadata(payload, labels), maxWidth),
      x,
      cursor,
    );
  }

  if (layout.urlSize <= 0) {
    ctx.restore();
    return cursor;
  }
  const urlY = Math.max(urlTop, cursor + layout.urlSize);
  drawUrlPill(ctx, payload, colors, labels, {
    x,
    y: urlY,
    align,
    maxWidth,
    height: urlHeight,
    fontSize: layout.urlSize,
  });
  ctx.restore();
  return urlY + urlHeight;
}

function drawUrlPill(
  ctx: CanvasRenderingContext2D,
  payload: SharePayload,
  colors: SocialShareColors,
  labels: ShareCardLabels | undefined,
  layout: {
    x: number;
    y: number;
    align: CanvasTextAlign;
    maxWidth: number;
    height: number;
    fontSize: number;
  },
) {
  const displayUrl = formatShareDisplayUrl(payload.url);
  if (!displayUrl) return;
  const { y, align, maxWidth, height, fontSize } = layout;
  const cta = labels?.cta?.trim() ?? "";
  const paddingX = fontSize * 0.95;
  const dotSize = fontSize * 0.42;
  const gap = fontSize * 0.55;
  const textMax = maxWidth - paddingX * 2 - dotSize - gap;
  ctx.save();
  const urlSize = fitFont(
    ctx,
    displayUrl,
    textMax,
    fontSize,
    Math.round(fontSize * 0.72),
    "600",
  );
  const urlText = truncateToWidth(ctx, displayUrl, textMax);
  const urlWidth = ctx.measureText(urlText).width;
  const ctaSize = Math.round(fontSize * 0.78);
  ctx.font = `800 ${ctaSize}px ${FONT_STACK}`;
  const ctaText = cta ? truncateToWidth(ctx, cta, textMax) : "";
  const ctaWidth = ctaText ? ctx.measureText(ctaText).width : 0;
  const pillHeight = height;
  const top = y;
  const width = Math.min(
    maxWidth,
    Math.max(urlWidth, ctaWidth) + dotSize + gap + paddingX * 2,
  );
  const left =
    align === "center"
      ? layout.x - width / 2
      : align === "right"
        ? layout.x - width
        : layout.x;

  ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
  roundedRect(ctx, left, top, width, pillHeight, Math.min(pillHeight / 2, 40));
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
  ctx.lineWidth = 2;
  ctx.stroke();

  const textX = left + paddingX + dotSize + gap;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let urlCenter = top + pillHeight / 2;
  if (ctaText) {
    const ctaCenter = top + pillHeight * 0.33;
    urlCenter = top + pillHeight * 0.66;
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.arc(
      left + paddingX + dotSize / 2,
      ctaCenter,
      dotSize / 2,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.font = `800 ${ctaSize}px ${FONT_STACK}`;
    ctx.fillStyle = colors.accent;
    ctx.fillText(ctaText, textX, ctaCenter + ctaSize * 0.06);
  } else {
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.arc(
      left + paddingX + dotSize / 2,
      urlCenter,
      dotSize / 2,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.font = `600 ${urlSize}px ${FONT_STACK}`;
  ctx.fillStyle = colors.cardSurface;
  ctx.fillText(urlText, textX, urlCenter + urlSize * 0.06);
  ctx.restore();
}

function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxSize: number,
  minSize: number,
  weight: string,
): number {
  let size = maxSize;
  ctx.font = `${weight} ${size}px ${FONT_STACK}`;
  while (size > minSize && ctx.measureText(text).width > maxWidth) {
    size -= 4;
    ctx.font = `${weight} ${size}px ${FONT_STACK}`;
  }
  return size;
}

function fitWrappedFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxSize: number,
  minSize: number,
  maxLines: number,
): number {
  let size = maxSize;
  while (size > minSize) {
    ctx.font = `800 ${size}px ${FONT_STACK}`;
    if (wrapLines(ctx, text, maxWidth).length <= maxLines) return size;
    size -= 4;
  }
  return minSize;
}

function truncateToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let value = text;
  while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth) {
    value = value.slice(0, -1);
  }
  return `${value.trimEnd()}…`;
}

function drawGeneratedStoryArtwork(
  ctx: CanvasRenderingContext2D,
  payload: SharePayload,
  x: number,
  y: number,
  size: number,
  logo: HTMLImageElement | null,
  colors: SocialShareColors,
  initialsSource?: string,
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

  if (logo)
    drawLogoImage(ctx, logo, x + size * 0.34, y + size * 0.16, size * 0.31);

  ctx.fillStyle = colors.softText;
  ctx.font = `800 ${Math.round(size * 0.3)}px ${FONT_STACK}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(
    getStoryInitials(initialsSource ?? payload.title),
    x + size / 2,
    y + size * 0.84,
  );

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
  ctx.font = `800 44px ${FONT_STACK}`;
  ctx.letterSpacing = "10px";
  ctx.fillText("CRATE", 214, 433);
  ctx.letterSpacing = "0px";
}

export function buildInstagramStorySubtitle(
  payload: SharePayload,
  labels?: ShareCardLabels,
): string {
  return labels?.subtitle || payload.subtitle?.trim() || "Crate";
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
  const ratio =
    image.naturalWidth > 0 ? image.naturalHeight / image.naturalWidth : 1;
  ctx.drawImage(image, x, y, width, width * ratio);
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

  const lime = ctx.createRadialGradient(
    width * 0.83,
    height * 0.93,
    20,
    width * 0.83,
    height * 0.93,
    760,
  );
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
  const naturalWidth = image.naturalWidth || width;
  const naturalHeight = image.naturalHeight || height;
  const scale = Math.max(width / naturalWidth, height / naturalHeight);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = (naturalWidth - sourceWidth) / 2;
  const sourceY = (naturalHeight - sourceHeight) / 2;
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

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
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
  }
  if (line) lines.push(line);
  return lines;
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines = 3,
): number {
  const lines = wrapLines(ctx, text, maxWidth);
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    const last = visible[visible.length - 1] || "";
    visible[visible.length - 1] = truncateToWidth(
      ctx,
      `${last.replace(/[.,;:!?-]+$/, "")} …`,
      maxWidth,
    );
  }
  visible.forEach((value, index) => {
    ctx.fillText(
      ctx.measureText(value).width > maxWidth
        ? truncateToWidth(ctx, value, maxWidth)
        : value,
      x,
      y + index * lineHeight,
    );
  });
  return y + Math.max(0, visible.length - 1) * lineHeight;
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

const DIGGING_COVER_GAP = 14;

export function drawDiggingStoryCard(
  ctx: CanvasRenderingContext2D,
  data: DiggingShareData,
  covers: (HTMLImageElement | null)[],
  logo: HTMLImageElement | null,
  colors: SocialShareColors,
) {
  const left = CARD_MARGIN + 24;
  const width = STORY_WIDTH - left * 2;
  const limit = STORY_HEIGHT - STORY_SAFE_BOTTOM;
  drawStoryBrand(ctx, logo, colors);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = colors.accent;
  ctx.font = `700 40px ${FONT_STACK}`;
  ctx.fillText(
    truncateToWidth(ctx, data.kicker, width),
    left,
    STORY_SAFE_TOP + 270,
  );

  ctx.fillStyle = colors.cardSurface;
  const headlineSize = fitWrappedFont(ctx, data.headline, width, 100, 60, 2);
  ctx.font = `800 ${headlineSize}px ${FONT_STACK}`;
  ctx.letterSpacing = `${Math.round(headlineSize * -0.045)}px`;
  const headlineEnd = drawWrappedText(
    ctx,
    data.headline,
    left,
    STORY_SAFE_TOP + 270 + headlineSize + 24,
    width,
    headlineSize * 0.95,
    2,
  );
  ctx.letterSpacing = "0px";

  const statsLabelY = limit - 8;
  const statsValueY = statsLabelY - 44;
  const listsLabelY = statsValueY - 64 - 56 - (64 + 2 * 52);
  const coversTop = headlineEnd + 56;
  const coversBottom = listsLabelY - 70;
  const cell = Math.min(
    (width - DIGGING_COVER_GAP * 3) / 4,
    (coversBottom - coversTop - DIGGING_COVER_GAP) / 2,
  );
  const gridWidth = cell * 4 + DIGGING_COVER_GAP * 3;
  const gridLeft = left + (width - gridWidth) / 2;
  const slots: [number, number, number][] = [
    [0, 0, 2],
    [2, 0, 1],
    [3, 0, 1],
    [2, 1, 1],
    [3, 1, 1],
  ];
  slots.forEach(([column, row, span], index) => {
    const size = cell * span + DIGGING_COVER_GAP * (span - 1);
    const x = gridLeft + column * (cell + DIGGING_COVER_GAP);
    const top = coversTop + row * (cell + DIGGING_COVER_GAP);
    ctx.save();
    roundedRect(ctx, x, top, size, size, 14);
    ctx.clip();
    const image = covers[index];
    if (image) {
      drawCoverImage(ctx, image, x, top, size, size);
    } else {
      ctx.fillStyle = colors.generatedMiddle;
      ctx.fillRect(x, top, size, size);
    }
    ctx.restore();
  });

  const columnWidth = (width - 48) / 2;
  drawDiggingList(
    ctx,
    data.topArtistsLabel,
    data.topArtists,
    left,
    listsLabelY,
    columnWidth,
    colors,
  );
  drawDiggingList(
    ctx,
    data.topTracksLabel,
    data.topTracks,
    left + columnWidth + 48,
    listsLabelY,
    columnWidth,
    colors,
  );

  const statWidth = width / 3;
  data.stats.slice(0, 3).forEach((stat, index) => {
    const x = left + index * statWidth;
    ctx.fillStyle = colors.cardSurface;
    const size = fitFont(ctx, stat.value, statWidth - 24, 64, 36, "800");
    ctx.font = `800 ${size}px ${FONT_STACK}`;
    ctx.letterSpacing = `${Math.round(size * -0.04)}px`;
    ctx.fillText(stat.value, x, statsValueY);
    ctx.letterSpacing = "0px";
    ctx.fillStyle = colors.accent;
    ctx.font = `600 28px ${FONT_STACK}`;
    ctx.fillText(
      truncateToWidth(ctx, stat.label, statWidth - 24),
      x,
      statsLabelY,
    );
  });

  ctx.fillStyle = colors.cardMutedInk;
  ctx.font = `500 30px ${FONT_STACK}`;
  ctx.fillText(truncateToWidth(ctx, data.credit, width), left, limit + 72);
}

function drawDiggingList(
  ctx: CanvasRenderingContext2D,
  label: string,
  items: string[],
  x: number,
  y: number,
  width: number,
  colors: SocialShareColors,
) {
  ctx.textAlign = "left";
  ctx.fillStyle = colors.accent;
  ctx.font = `600 30px ${FONT_STACK}`;
  ctx.fillText(truncateToWidth(ctx, label, width), x, y);
  items.slice(0, 3).forEach((item, index) => {
    const top = y + 64 + index * 52;
    ctx.fillStyle = colors.cardMutedInk;
    ctx.font = `700 34px ${FONT_STACK}`;
    ctx.fillText(String(index + 1), x, top);
    ctx.fillStyle = colors.cardSurface;
    ctx.font = `600 34px ${FONT_STACK}`;
    ctx.fillText(truncateToWidth(ctx, item, width - 44), x + 44, top);
  });
}
