// TEST_GAP: collectWords and buildTextTargets need real layout and 2D canvas text rendering, which jsdom does not provide; pickTextPoints is unit-tested and the formation is checked in e2e/home.spec.ts.
import type { Random } from "./sources";

export interface WordBox {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  font: string;
  fontSize: number;
  letterSpacing: string;
  ink: boolean;
}

export function pickTextPoints(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  count: number,
  origin: { x: number; y: number },
  random: Random = Math.random,
  threshold = 96,
): Float32Array | null {
  const filled: number[] = [];
  for (let i = 0; i < width * height; i++) {
    if (pixels[i * 4 + 3] > threshold) filled.push(i);
  }
  if (!filled.length) return null;
  const points = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const pixel = filled[Math.floor(random() * filled.length)];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    points[i * 3] = origin.x + x + random();
    points[i * 3 + 1] = origin.y + y + random();
    points[i * 3 + 2] = pixels[pixel * 4 + 1] > pixels[pixel * 4] ? 1 : 0;
  }
  return points;
}

export function collectWords(paragraphs: HTMLElement[]): WordBox[] {
  const words: WordBox[] = [];
  const range = document.createRange();
  for (const paragraph of paragraphs) {
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent) continue;
      const style = getComputedStyle(parent);
      const ink = Boolean(parent.closest(".hl"));
      for (const match of (node.textContent ?? "").matchAll(/\S+/g)) {
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const rect = range.getBoundingClientRect();
        if (!rect.width) continue;
        words.push({
          text: match[0],
          left: rect.left + scrollX,
          top: rect.top + scrollY,
          width: rect.width,
          height: rect.height,
          font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
          fontSize: parseFloat(style.fontSize),
          letterSpacing: style.letterSpacing,
          ink,
        });
      }
    }
  }
  return words;
}

export function buildTextTargets(
  words: WordBox[],
  count: number,
  random: Random = Math.random,
): Float32Array | null {
  if (!words.length) return null;
  const left = Math.floor(Math.min(...words.map((word) => word.left))) - 4;
  const top = Math.floor(Math.min(...words.map((word) => word.top))) - 4;
  const right =
    Math.ceil(Math.max(...words.map((word) => word.left + word.width))) + 4;
  const bottom =
    Math.ceil(Math.max(...words.map((word) => word.top + word.height))) + 4;
  const canvas = document.createElement("canvas");
  canvas.width = right - left;
  canvas.height = bottom - top;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.textBaseline = "alphabetic";
  for (const word of words) {
    ctx.font = word.font;
    if ("letterSpacing" in ctx)
      ctx.letterSpacing =
        word.letterSpacing === "normal" ? "0px" : word.letterSpacing;
    const metrics = ctx.measureText(word.text);
    const ascent = metrics.fontBoundingBoxAscent || word.fontSize * 0.8;
    const descent = metrics.fontBoundingBoxDescent || word.fontSize * 0.2;
    const baseline =
      word.top - top + (word.height - ascent - descent) / 2 + ascent;
    ctx.fillStyle = word.ink ? "#00ff00" : "#ff0000";
    ctx.fillText(word.text, word.left - left, baseline);
  }
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return pickTextPoints(
    data,
    canvas.width,
    canvas.height,
    count,
    { x: left, y: top },
    random,
  );
}
