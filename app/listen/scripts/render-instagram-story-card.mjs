#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";

const WIDTH = 1080;
const HEIGHT = 1920;
const CRATE_LOGO_PATH = resolve("app/listen/public/icons/logo.svg");
const CRATE_LOGO_HREF = resolveSvgHref(CRATE_LOGO_PATH);
const PLEX_HREF = resolveFontHref("app/shared/fonts/ibm-plex-sans/latin.woff2");
const PLEX_EXT_HREF = resolveFontHref(
  "app/shared/fonts/ibm-plex-sans/latin-ext.woff2",
);

const options = parseArgs(process.argv.slice(2));
const kind = (options.kind || "album").toLowerCase();
const title = options.title || "FENIAN";
const subtitle = options.subtitle || "Album by KNEECAP";
const out = resolve(options.out || "/tmp/crate-instagram-story.svg");
const imageHref = resolveImageHref(options.image);

writeFileSync(out, renderStoryCard({ kind, title, subtitle, imageHref }));
console.log(`Instagram story preview written to ${out}`);

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value?.startsWith("--")) continue;
    const key = value.slice(2);
    const next = args[index + 1];
    if (next === undefined || next.startsWith("--")) {
      parsed[key] = "1";
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function resolveImageHref(image) {
  if (!image) return null;
  if (/^https?:\/\//i.test(image) || image.startsWith("data:")) return image;
  const path = resolve(image);
  if (!existsSync(path)) {
    console.warn(`Artwork not found: ${path}. Rendering fallback card.`);
    return null;
  }
  const bytes = readFileSync(path);
  const mime = mimeForPath(path);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function resolveSvgHref(path) {
  if (!existsSync(path)) return null;
  const svg = readFileSync(path, "utf8");
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function resolveFontHref(path) {
  const resolved = resolve(path);
  if (!existsSync(resolved)) return null;
  const bytes = readFileSync(resolved);
  return `data:font/woff2;base64,${bytes.toString("base64")}`;
}

function mimeForPath(path) {
  const ext = extname(path).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

function renderStoryCard({ kind, title, subtitle, imageHref }) {
  const hasImage = Boolean(imageHref);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${escapeAttr(
    title,
  )} story card">
  <defs>
    <filter id="bgBlur" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="10" />
      <feColorMatrix type="saturate" values="1.06" />
    </filter>
    <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="42" stdDeviation="42" flood-color="#000000" flood-opacity="0.68" />
    </filter>
    <radialGradient id="fallbackGlow" cx="28%" cy="16%" r="90%">
      <stop offset="0" stop-color="#22d3ee" stop-opacity="0.58" />
      <stop offset="1" stop-color="#020306" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="fallbackArt" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#092f36" />
      <stop offset="0.5" stop-color="#10131a" />
      <stop offset="1" stop-color="#020306" />
    </linearGradient>
    <linearGradient id="fallbackPage" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#071013" />
      <stop offset="0.45" stop-color="#0b0c12" />
      <stop offset="1" stop-color="#030407" />
    </linearGradient>
    <radialGradient id="vignette" cx="50%" cy="44%" r="72%">
      <stop offset="0" stop-color="#000000" stop-opacity="0.04" />
      <stop offset="0.58" stop-color="#000000" stop-opacity="0.34" />
      <stop offset="1" stop-color="#000000" stop-opacity="0.88" />
    </radialGradient>
    <linearGradient id="pageShade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000000" stop-opacity="0.2" />
      <stop offset="0.68" stop-color="#000000" stop-opacity="0" />
      <stop offset="1" stop-color="#000000" stop-opacity="0.74" />
    </linearGradient>
    <clipPath id="coverClip">
      <rect x="148" y="493" width="784" height="784" rx="4" />
    </clipPath>
  </defs>
  <style>
    ${renderPlexFontFaces()}
    .font { font-family: "IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .brand { font-weight: 900; letter-spacing: 10px; fill: #f8fafc; }
    .title { font-weight: 900; fill: #111318; }
    .subtitle { font-weight: 800; fill: #62636d; }
  </style>

  ${hasImage ? renderImageBackground(imageHref) : renderFallbackBackground()}
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#vignette)" />
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#pageShade)" />

  ${renderBrand()}

  <g filter="url(#cardShadow)">
    <rect x="120" y="468" width="840" height="1130" rx="18" fill="#f8fafc" />
    ${
      hasImage
        ? `<image href="${escapeAttr(
            imageHref,
          )}" x="148" y="493" width="784" height="784" preserveAspectRatio="xMidYMid slice" clip-path="url(#coverClip)" />`
        : renderFallbackArtwork(title)
    }
    <rect x="148" y="1277" width="784" height="290" fill="#f8fafc" />
    ${renderCenteredText(
      title.toUpperCase(),
      540,
      1394,
      690,
      76,
      86,
      "title font",
      2,
    )}
    ${renderCenteredText(subtitle, 540, 1514, 690, 43, 54, "subtitle font", 2)}
  </g>

</svg>
`;
}

function renderPlexFontFaces() {
  return `
    ${
      PLEX_HREF
        ? `@font-face { font-family: "IBM Plex Sans"; src: url("${PLEX_HREF}") format("woff2"); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; font-weight: 100 700; font-style: normal; font-display: swap; }`
        : ""
    }
    ${
      PLEX_EXT_HREF
        ? `@font-face { font-family: "IBM Plex Sans"; src: url("${PLEX_EXT_HREF}") format("woff2"); unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF; font-weight: 100 700; font-style: normal; font-display: swap; }`
        : ""
    }`;
}

function renderImageBackground(imageHref) {
  return `
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#020304" />
  <image href="${escapeAttr(
    imageHref,
  )}" x="-44" y="-44" width="1168" height="2008" preserveAspectRatio="xMidYMid slice" filter="url(#bgBlur)" opacity="0.62" />
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#000000" opacity="0.28" />`;
}

function renderFallbackBackground() {
  return `
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#fallbackPage)" />
  <circle cx="170" cy="120" r="900" fill="#22d3ee" opacity="0.18" />
  <circle cx="900" cy="1780" r="760" fill="#d6ff63" opacity="0.09" />`;
}

function renderFallbackArtwork(title) {
  return `
    <rect x="148" y="493" width="784" height="784" rx="4" fill="url(#fallbackArt)" />
    <rect x="148" y="493" width="784" height="784" rx="4" fill="url(#fallbackGlow)" />
    ${renderLogoImage(340, 610, 300)}
    <text x="540" y="1180" text-anchor="middle" class="font" font-size="230" font-weight="900" fill="#f8fafc" opacity="0.08">${escapeText(
      initials(title),
    )}</text>`;
}

function renderBrand() {
  return `
  ${renderLogoImage(120, 380, 72)}
  <text x="214" y="433" class="brand font" font-size="44">CRATE</text>`;
}

function renderLogoImage(x, y, width) {
  if (!CRATE_LOGO_HREF) return "";
  const height = Math.round(width * (1120 / 1052));
  return `<image href="${CRATE_LOGO_HREF}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" />`;
}

function renderCenteredText(
  text,
  x,
  y,
  maxWidth,
  fontSize,
  lineHeight,
  className,
  maxLines,
) {
  const lines = wrapText(text, maxWidth, fontSize, maxLines);
  return `<text x="${x}" y="${y}" text-anchor="middle" class="${className}" font-size="${fontSize}">
    ${lines
      .map(
        (line, index) =>
          `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeText(
            line,
          )}</tspan>`,
      )
      .join("\n    ")}
  </text>`;
}

function wrapText(text, maxWidth, fontSize, maxLines) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  const averageCharWidth = fontSize * 0.58;
  const fits = (value) => value.length * averageCharWidth <= maxWidth;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (fits(next) || !line) {
      line = next;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (words.join(" ") !== lines.join(" ")) {
    const last = lines[lines.length - 1] || "";
    lines[lines.length - 1] = `${last.replace(/[.,;:!?-]+$/, "")}...`;
  }
  return lines.slice(0, maxLines);
}

function initials(value) {
  return String(value)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() || "")
    .join("");
}

function escapeText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(value) {
  return escapeText(value).replaceAll('"', "&quot;");
}
