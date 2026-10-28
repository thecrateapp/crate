import type { CaptureEvent } from "../events";

export interface Knots {
  local: number[];
  timeline: number[];
}

export interface SyncInput {
  events: CaptureEvent[];
  end: number;
}

export interface SyncedTrack {
  knots: Knots;
  events: CaptureEvent[];
}

export function localTime({ local, timeline }: Knots, time: number): number {
  const last = timeline.length - 1;
  if (time >= timeline[last]) return local[last] + (time - timeline[last]);
  let index = 1;
  while (timeline[index] <= time) index++;
  const elapsed = time - timeline[index - 1];
  return local[index - 1] + Math.min(elapsed, local[index] - local[index - 1]);
}

export function syncTracks(tracks: SyncInput[]): {
  duration: number;
  tracks: SyncedTrack[];
} {
  const counts = new Set(tracks.map((track) => track.events.length));
  if (counts.size !== 1) {
    return {
      duration: Math.max(...tracks.map((track) => track.end)),
      tracks: tracks.map(({ events }) => ({
        knots: { local: [0], timeline: [0] },
        events,
      })),
    };
  }

  const locals = tracks.map((track) => [
    0,
    ...track.events.map((event) => event.t),
  ]);
  const timeline = [0];
  for (let index = 1; index < locals[0].length; index++) {
    const step = Math.max(
      ...locals.map((local) => local[index] - local[index - 1]),
    );
    timeline.push(timeline[index - 1] + step);
  }
  const last = timeline.length - 1;

  return {
    duration: Math.max(
      ...tracks.map(
        (track, index) => timeline[last] + track.end - locals[index][last],
      ),
    ),
    tracks: tracks.map((track, index) => ({
      knots: { local: locals[index], timeline },
      events: track.events.map((event, order) => ({
        ...event,
        t: timeline[order + 1],
      })),
    })),
  };
}
