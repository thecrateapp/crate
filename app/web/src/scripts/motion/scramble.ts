import {
  type ScrambleOptions,
  scrambleText as scramble,
} from "../../../../shared/web/scramble";
import { reducedMotion } from "./env";

export function scrambleText(
  element: HTMLElement,
  text: string,
  options: ScrambleOptions = {},
): () => void {
  return scramble(element, text, {
    ...options,
    reducedMotion: options.reducedMotion ?? reducedMotion(),
  });
}
