export interface ScreencastOptions {
  autoplay: boolean;
  labels: { play: string; pause: string };
}

export function canAutoplay(reducedMotion: boolean): boolean {
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection;
  return !reducedMotion && !connection?.saveData;
}

export function createScreencast(
  root: HTMLElement,
  { autoplay, labels }: ScreencastOptions,
): () => void {
  const slots = [...root.querySelectorAll<HTMLElement>("[data-chapter]")];
  const tabs = [...root.querySelectorAll<HTMLButtonElement>("[data-tab]")];
  const toggle = root.querySelector<HTMLButtonElement>("[data-toggle]");
  const videos = slots.map((slot) => slot.querySelector("video"));
  const listeners = new AbortController();
  const { signal } = listeners;
  let active = Math.max(
    0,
    slots.findIndex((slot) => slot.hasAttribute("data-active")),
  );
  let wanted = autoplay;
  let inView = false;

  function render(playing: boolean) {
    if (!toggle) return;
    toggle.dataset.state = playing ? "pause" : "play";
    toggle.setAttribute("aria-label", playing ? labels.pause : labels.play);
  }

  function sync() {
    const video = videos[active];
    if (!video) return render(false);
    if (inView && wanted) {
      render(true);
      video.play().catch(() => {
        wanted = false;
        render(false);
      });
    } else {
      video.pause();
      render(false);
    }
  }

  function show(index: number) {
    if (index === active) return;
    const previous = videos[active];
    if (previous) {
      previous.pause();
      previous.currentTime = 0;
    }
    active = index;
    slots.forEach((slot, i) =>
      slot.toggleAttribute("data-active", i === index),
    );
    tabs.forEach((tab, i) => {
      tab.closest("li")?.toggleAttribute("data-active", i === index);
      tab.setAttribute("aria-pressed", String(i === index));
    });
    sync();
  }

  tabs.forEach((tab, index) =>
    tab.addEventListener("click", () => show(index), { signal }),
  );
  videos.forEach(
    (video) =>
      video?.addEventListener(
        "ended",
        () => show((active + 1) % slots.length),
        {
          signal,
        },
      ),
  );
  toggle?.addEventListener(
    "click",
    () => {
      wanted = videos[active]?.paused ?? true;
      sync();
    },
    { signal },
  );

  const observer = new IntersectionObserver(
    ([entry]) => {
      inView = entry.isIntersecting;
      sync();
    },
    { threshold: 0.4 },
  );
  observer.observe(root);
  render(false);

  return () => {
    observer.disconnect();
    listeners.abort();
    videos.forEach((video) => video?.pause());
  };
}
