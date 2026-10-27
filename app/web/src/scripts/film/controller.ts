export interface FilmChapter {
  time: number;
}

export interface FilmLabels {
  play: string;
  pause: string;
  replay: string;
  soundOn: string;
  soundOff: string;
}

export interface FilmController {
  start(): void;
  dispose(): void;
}

export function activeChapter(chapters: FilmChapter[], time: number): number {
  let active = -1;
  chapters.forEach((chapter, index) => {
    if (chapter.time <= time + 0.05) active = index;
  });
  return active;
}

export function createFilm(
  root: HTMLElement,
  labels: FilmLabels,
): FilmController {
  const video = root.querySelector<HTMLVideoElement>("[data-film-video]");
  const toggle = root.querySelector<HTMLButtonElement>("[data-film-toggle]");
  const sound = root.querySelector<HTMLButtonElement>("[data-film-sound]");
  const chapterButtons = [
    ...root.querySelectorAll<HTMLButtonElement>("[data-film-chapter]"),
  ];
  const chapters = chapterButtons.map((button) => ({
    time: Number(button.dataset.time),
  }));
  const listeners = new AbortController();
  const { signal } = listeners;
  let loaded = false;
  let wanted = false;
  let inView = false;

  function load() {
    if (!video || loaded) return;
    loaded = true;
    video
      .querySelectorAll<HTMLSourceElement>("source[data-src]")
      .forEach((source) => {
        source.src = source.dataset.src ?? "";
      });
    video.load();
  }

  function render() {
    if (!video) return;
    const playing = !video.paused && !video.ended;
    root.dataset.state = playing ? "playing" : video.ended ? "ended" : "paused";
    if (toggle) {
      toggle.dataset.state = playing ? "pause" : "play";
      toggle.setAttribute(
        "aria-label",
        playing ? labels.pause : video.ended ? labels.replay : labels.play,
      );
    }
    if (sound) {
      sound.setAttribute("aria-pressed", String(!video.muted));
      sound.setAttribute(
        "aria-label",
        video.muted ? labels.soundOn : labels.soundOff,
      );
    }
    const active = activeChapter(chapters, video.currentTime);
    chapterButtons.forEach((button, index) => {
      button.toggleAttribute("data-active", index === active);
      button.setAttribute("aria-current", String(index === active));
    });
  }

  function sync() {
    if (!video) return;
    if (wanted && inView) {
      load();
      video.play().catch(() => {
        wanted = false;
        render();
      });
    } else {
      video.pause();
    }
    render();
  }

  function start() {
    if (wanted) return;
    wanted = true;
    sync();
  }

  if (video) {
    video.muted = true;
    for (const event of [
      "play",
      "pause",
      "ended",
      "timeupdate",
      "volumechange",
      "seeked",
    ]) {
      video.addEventListener(event, render, { signal });
    }
    video.addEventListener("ended", () => (wanted = false), { signal });
  }

  toggle?.addEventListener(
    "click",
    () => {
      if (!video) return;
      if (video.ended) video.currentTime = 0;
      wanted = video.paused || video.ended;
      inView = true;
      sync();
    },
    { signal },
  );

  sound?.addEventListener(
    "click",
    () => {
      if (!video) return;
      video.muted = !video.muted;
      if (!video.muted && video.paused) {
        wanted = true;
        inView = true;
        sync();
      }
      render();
    },
    { signal },
  );

  chapterButtons.forEach((button, index) => {
    button.addEventListener(
      "click",
      () => {
        if (!video) return;
        load();
        video.currentTime = chapters[index].time;
        wanted = true;
        inView = true;
        sync();
      },
      { signal },
    );
  });

  const nearby = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) load();
    },
    { rootMargin: "600px 0px" },
  );
  const visible = new IntersectionObserver(
    (entries) => {
      inView = entries.some((entry) => entry.isIntersecting);
      sync();
    },
    { threshold: 0.35 },
  );
  nearby.observe(root);
  visible.observe(root);
  render();

  return {
    start,
    dispose() {
      listeners.abort();
      nearby.disconnect();
      visible.disconnect();
      video?.pause();
    },
  };
}
