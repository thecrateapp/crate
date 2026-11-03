import { reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";

export function initStackMap(root: HTMLElement): Cleanup {
  const video = root.querySelector<HTMLVideoElement>("video");
  const shot = video?.closest<HTMLElement>(".shot");

  const onPlaying = () => shot?.classList.add("is-video");
  video?.addEventListener("playing", onPlaying);

  const observer = new IntersectionObserver(
    ([entry]) => {
      if (!video || reducedMotion()) return;
      if (entry?.isIntersecting) video.play().catch(() => {});
      else video.pause();
    },
    { rootMargin: "5% 0px" },
  );
  observer.observe(root);

  return () => {
    observer.disconnect();
    video?.removeEventListener("playing", onPlaying);
    video?.pause();
    shot?.classList.remove("is-video");
  };
}
