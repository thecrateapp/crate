/** One screencast chapter: a numbered title and, once recorded, its poster and clips.
 * A chapter without an mp4 renders as a placeholder slot. */
export interface ScreencastChapter {
  id: string;
  number: string;
  title: string;
  poster?: string;
  webm?: string;
  mp4?: string;
}
