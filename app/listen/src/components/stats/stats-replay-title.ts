import type { ReplayMix } from "./stats-types";

/** Pure replay copy helpers: no app imports, so showcase hosts can load them. */
type ReplayTranslate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

function replayYear(replay: ReplayMix): string {
  return /^year:(\d{4})$/.exec(replay.window)?.[1] ?? "";
}

export function localizedReplayTitle(
  replay: ReplayMix | undefined,
  t: ReplayTranslate,
): string | undefined {
  if (replay?.title_key) {
    return t(replay.title_key, {
      defaultValue: replay.title,
      year: replayYear(replay),
    });
  }
  return replay?.title || undefined;
}

export function localizedReplaySubtitle(
  replay: ReplayMix | undefined,
  t: ReplayTranslate,
): string | undefined {
  if (replay?.subtitle_key) {
    return t(replay.subtitle_key, {
      defaultValue: replay.subtitle,
      year: replayYear(replay),
    });
  }
  return replay?.subtitle || undefined;
}
