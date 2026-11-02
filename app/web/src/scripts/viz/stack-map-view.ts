import { reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";

export function initStackMap(root: HTMLElement): Cleanup {
  const buttons = [
    ...root.querySelectorAll<HTMLButtonElement>("[data-view-button]"),
  ];
  const video = root.querySelector<HTMLVideoElement>("video");
  const frame = video?.closest<HTMLElement>(".frame");
  let visible = false;

  const sync = () => {
    if (!video || reducedMotion()) return;
    if (visible && root.dataset.view === "3d") {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  };

  const show = (view: string) => {
    root.dataset.view = view;
    for (const button of buttons)
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.viewButton === view),
      );
    sync();
  };

  const onClick = (event: Event) =>
    show((event.currentTarget as HTMLButtonElement).dataset.viewButton!);
  buttons.forEach((button) => button.addEventListener("click", onClick));

  const onPlaying = () => frame?.classList.add("is-video");
  video?.addEventListener("playing", onPlaying);

  const observer = new IntersectionObserver(
    ([entry]) => {
      visible = !!entry?.isIntersecting;
      sync();
    },
    { rootMargin: "5% 0px" },
  );
  observer.observe(root);

  return () => {
    observer.disconnect();
    buttons.forEach((button) => button.removeEventListener("click", onClick));
    video?.removeEventListener("playing", onPlaying);
    video?.pause();
    frame?.classList.remove("is-video");
    show("3d");
  };
}
