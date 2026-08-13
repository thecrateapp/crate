import type { Filter } from "konva/lib/Node";

interface HeroImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.floor(value)));
}

function roundByte(value: number): number {
  return Math.max(0, Math.min(255, Math.floor(value + 0.5)));
}

export function applyPillowGrayscale(imageData: HeroImageData): void {
  const { data } = imageData;
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index] ?? 0;
    const green = data[index + 1] ?? 0;
    const blue = data[index + 2] ?? 0;
    const gray = roundByte(red * 0.299 + green * 0.587 + blue * 0.114);
    data[index] = gray;
    data[index + 1] = gray;
    data[index + 2] = gray;
  }
}

export function applyPillowBrightness(
  imageData: HeroImageData,
  factor: number,
): void {
  const { data } = imageData;
  for (let index = 0; index < data.length; index += 4) {
    data[index] = clampByte((data[index] ?? 0) * factor);
    data[index + 1] = clampByte((data[index + 1] ?? 0) * factor);
    data[index + 2] = clampByte((data[index + 2] ?? 0) * factor);
  }
}

export function applyPillowContrast(
  imageData: HeroImageData,
  factor: number,
): void {
  const { data, width, height } = imageData;
  const pixelCount = Math.max(1, width * height);
  let luminanceTotal = 0;
  for (let index = 0; index < data.length; index += 4) {
    luminanceTotal += roundByte(
      (data[index] ?? 0) * 0.299 +
        (data[index + 1] ?? 0) * 0.587 +
        (data[index + 2] ?? 0) * 0.114,
    );
  }
  const mean = Math.floor(luminanceTotal / pixelCount + 0.5);

  for (let index = 0; index < data.length; index += 4) {
    data[index] = clampByte(mean + ((data[index] ?? 0) - mean) * factor);
    data[index + 1] = clampByte(
      mean + ((data[index + 1] ?? 0) - mean) * factor,
    );
    data[index + 2] = clampByte(
      mean + ((data[index + 2] ?? 0) - mean) * factor,
    );
  }
}

export const pillowGrayscaleFilter: Filter = function (imageData) {
  applyPillowGrayscale(imageData);
};

export const pillowBrightnessFilter: Filter = function (imageData) {
  applyPillowBrightness(imageData, this.brightness());
};

export const pillowContrastFilter: Filter = function (imageData) {
  applyPillowContrast(imageData, this.contrast());
};
