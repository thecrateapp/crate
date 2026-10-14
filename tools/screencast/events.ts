export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export type CaptureEvent =
  | { t: number; type: "click"; x: number; y: number; box: Box }
  | { t: number; type: "scroll"; x: number; y: number; deltaY: number };

export interface EventLog {
  readonly events: CaptureEvent[];
  click(box: Box, at: number): void;
  scroll(deltaY: number, at: number): void;
}

export function createEventLog(
  startTime: number,
  origin: Point = { x: 0, y: 0 },
): EventLog {
  const events: CaptureEvent[] = [];
  let pointer = origin;
  const seconds = (at: number) => Math.round(at - startTime) / 1000;

  return {
    events,
    click(box, at) {
      pointer = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      events.push({ t: seconds(at), type: "click", ...pointer, box });
    },
    scroll(deltaY, at) {
      events.push({ t: seconds(at), type: "scroll", ...pointer, deltaY });
    },
  };
}
