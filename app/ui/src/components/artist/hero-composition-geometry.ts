export interface CompositionSize {
  width: number;
  height: number;
}

export interface CompositionPoint {
  x: number;
  y: number;
}

export type CompositionFrame = CompositionPoint & CompositionSize;

export type CompositionCrop = CompositionFrame;

export type HeroMode = "crop" | "extend";
export type HeroRotation = 0 | 90 | 180 | 270;

export interface HeroRecipe {
  mode: HeroMode;
  crop: CompositionCrop;
  position_x: number;
  position_y: number;
  scale: number;
  flip_horizontal: boolean;
  rotation: HeroRotation;
  blur: number;
  feather: number;
  gradient: number;
  grayscale?: boolean;
  brightness?: number;
  contrast?: number;
}

const MIN_FILL_SCALE = 0.25;
const MAX_FILL_SCALE = 2;
const MIN_FILL_POSITION = -1;
const MAX_FILL_POSITION = 2;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function roundedFrame(frame: CompositionFrame): CompositionFrame {
  const x = Math.round(frame.x);
  const y = Math.round(frame.y);
  return {
    x: x || 0,
    y: y || 0,
    width: Math.max(1, Math.round(frame.width)),
    height: Math.max(1, Math.round(frame.height)),
  };
}

export function centeredCropForAspect(
  image: CompositionSize,
  aspect: number,
): CompositionCrop {
  if (image.width <= 0 || image.height <= 0 || aspect <= 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  const imageAspect = image.width / image.height;
  if (imageAspect > aspect) {
    const width = image.height * aspect;
    return roundedFrame({
      x: (image.width - width) / 2,
      y: 0,
      width,
      height: image.height,
    });
  }

  const height = image.width / aspect;
  return roundedFrame({
    x: 0,
    y: (image.height - height) / 2,
    width: image.width,
    height,
  });
}

export function cropFrameForCanvas(
  image: CompositionSize,
  canvas: CompositionSize,
  crop: CompositionCrop,
): CompositionFrame {
  const scale = Math.max(
    canvas.width / Math.max(crop.width, 1),
    canvas.height / Math.max(crop.height, 1),
  );
  return roundedFrame({
    x: -crop.x * scale,
    y: -crop.y * scale,
    width: image.width * scale,
    height: image.height * scale,
  });
}

export function constrainCoverFrame(
  frame: CompositionFrame,
  canvas: CompositionSize,
): CompositionFrame {
  const width = Math.max(frame.width, canvas.width);
  const height = Math.max(frame.height, canvas.height);
  return roundedFrame({
    x: clamp(frame.x, canvas.width - width, 0),
    y: clamp(frame.y, canvas.height - height, 0),
    width,
    height,
  });
}

export function cropFromCanvasFrame(
  image: CompositionSize,
  canvas: CompositionSize,
  rawFrame: CompositionFrame,
): CompositionCrop {
  const frame = constrainCoverFrame(rawFrame, canvas);
  const scale = frame.width / Math.max(image.width, 1);
  const width = Math.min(image.width, canvas.width / scale);
  const height = Math.min(image.height, canvas.height / scale);
  return roundedFrame({
    x: clamp(-frame.x / scale, 0, image.width - width),
    y: clamp(-frame.y / scale, 0, image.height - height),
    width,
    height,
  });
}

export function zoomCrop(
  crop: CompositionCrop,
  image: CompositionSize,
  factor: number,
  aspect: number,
): CompositionCrop {
  if (factor <= 0 || aspect <= 0) return crop;
  const centerX = crop.x + crop.width / 2;
  const centerY = crop.y + crop.height / 2;
  let width = clamp(crop.width / factor, 1, image.width);
  let height = width / aspect;

  if (height > image.height) {
    height = image.height;
    width = height * aspect;
  }

  return roundedFrame({
    x: clamp(centerX - width / 2, 0, image.width - width),
    y: clamp(centerY - height / 2, 0, image.height - height),
    width,
    height,
  });
}

export function fillSubjectFrame(
  image: CompositionSize,
  canvas: CompositionSize,
  options: { positionX: number; positionY: number; scale: number },
): CompositionFrame {
  const fitScale = Math.max(
    canvas.width / Math.max(image.width, 1),
    canvas.height / Math.max(image.height, 1),
  );
  const scale = clamp(options.scale, MIN_FILL_SCALE, MAX_FILL_SCALE);
  const width = image.width * fitScale * scale;
  const height = image.height * fitScale * scale;
  return roundedFrame({
    x: offsetFromFillPosition(
      canvas.width,
      width,
      clamp(options.positionX, MIN_FILL_POSITION, MAX_FILL_POSITION),
    ),
    y: offsetFromFillPosition(
      canvas.height,
      height,
      clamp(options.positionY, MIN_FILL_POSITION, MAX_FILL_POSITION),
    ),
    width,
    height,
  });
}

function offsetFromFillPosition(
  canvasLength: number,
  subjectLength: number,
  position: number,
): number {
  const available = canvasLength - subjectLength;
  if (position >= 0 && position <= 1) return available * position;
  const direction = available < 0 ? -1 : 1;
  if (position < 0) return position * canvasLength * direction;
  return available + (position - 1) * canvasLength * direction;
}

function fillPositionFromOffset(
  canvasLength: number,
  subjectLength: number,
  offset: number,
): number {
  const available = canvasLength - subjectLength;
  const direction = available < 0 ? -1 : 1;
  const directionalOffset = offset * direction;
  const directionalAvailable = Math.abs(available);

  if (directionalOffset < 0) {
    return clamp(directionalOffset / canvasLength, MIN_FILL_POSITION, 0);
  }
  if (directionalOffset > directionalAvailable) {
    return clamp(
      1 + (directionalOffset - directionalAvailable) / canvasLength,
      1,
      MAX_FILL_POSITION,
    );
  }
  if (directionalAvailable < 0.5) return 0.5;
  return directionalOffset / directionalAvailable;
}

export function fillPositionFromCanvas(
  image: CompositionSize,
  canvas: CompositionSize,
  rawScale: number,
  point: CompositionPoint,
): { positionX: number; positionY: number } {
  const frame = fillSubjectFrame(image, canvas, {
    positionX: 0.5,
    positionY: 0.5,
    scale: rawScale,
  });
  return {
    positionX: fillPositionFromOffset(canvas.width, frame.width, point.x),
    positionY: fillPositionFromOffset(canvas.height, frame.height, point.y),
  };
}

export function clampFillScale(scale: number): number {
  return clamp(scale, MIN_FILL_SCALE, MAX_FILL_SCALE);
}
