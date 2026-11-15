import { reducedMotion } from "@crate-web/scripts/motion/env";

type State = "loading" | "video" | "poster" | "placeholder";

const setState = (figure: HTMLElement, state: State) => {
  figure.dataset.state = state;
};

/** Replaces a video that cannot play with its poster, or a hairline placeholder. */
export function fallBack(figure: HTMLElement): void {
  const video = figure.querySelector("video");
  if (!video) return;
  const poster = video.getAttribute("poster");
  const label = video.getAttribute("aria-label") ?? "";
  video.remove();
  if (!poster) {
    setState(figure, "placeholder");
    return;
  }
  const image = document.createElement("img");
  image.alt = label;
  image.decoding = "async";
  image.addEventListener("load", () => setState(figure, "poster"), {
    once: true,
  });
  image.addEventListener(
    "error",
    () => {
      image.remove();
      setState(figure, "placeholder");
    },
    { once: true },
  );
  image.src = poster;
  figure.prepend(image);
}

function noSource(video: HTMLVideoElement): boolean {
  return (
    video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE ||
    video.error !== null
  );
}

export function mountClips(): () => void {
  const figures = [...document.querySelectorAll<HTMLElement>("[data-clip]")];
  const still = reducedMotion();
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const video = entry.target.querySelector("video");
      if (!video) continue;
      if (entry.isIntersecting) void video.play().catch(() => {});
      else video.pause();
    }
  });

  for (const figure of figures) {
    const video = figure.querySelector("video");
    if (!video) continue;
    const sources = video.querySelectorAll("source");
    const last = sources[sources.length - 1];
    // A <source> error does not bubble and may fire before this script runs.
    last?.addEventListener("error", () => fallBack(figure), { once: true });
    video.addEventListener("error", () => fallBack(figure), { once: true });
    video.addEventListener("loadeddata", () => setState(figure, "video"), {
      once: true,
    });
    if (noSource(video)) {
      fallBack(figure);
      continue;
    }
    if (video.readyState >= 2) setState(figure, "video");
    if (!still && video.hasAttribute("data-autoplay")) observer.observe(figure);
  }
  return () => observer.disconnect();
}
