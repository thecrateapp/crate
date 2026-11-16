import type { Cleanup } from "@crate-web/scripts/motion/page";

// Plays the page's background loop only while it is on screen, the tab is visible and
// the viewer has not asked for reduced motion; otherwise the poster stays. The video carries no
// autoplay attribute, so without this script the poster is all there is.
export function mountBackdrop(root: ParentNode = document): Cleanup {
  const video = root.querySelector<HTMLVideoElement>("[data-backdrop] video");
  if (!video) return () => {};

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  let visible = true;

  const sync = () => {
    if (visible && !document.hidden && !reduce.matches) {
      if (video.preload === "none") video.preload = "auto";
      void video.play()?.catch(() => {});
    } else {
      video.pause();
    }
  };

  const observer =
    "IntersectionObserver" in window
      ? new IntersectionObserver(([entry]) => {
          visible = entry?.isIntersecting ?? true;
          sync();
        })
      : undefined;
  observer?.observe(video);
  reduce.addEventListener("change", sync);
  document.addEventListener("visibilitychange", sync);
  sync();

  return () => {
    observer?.disconnect();
    reduce.removeEventListener("change", sync);
    document.removeEventListener("visibilitychange", sync);
    video.pause();
  };
}
