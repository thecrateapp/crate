export interface ShowcaseOptions {
  autoplay: boolean;
  interval?: number;
  labels: {
    position: (index: number, count: number) => string;
    pause: string;
    play: string;
  };
}

export function step(index: number, delta: number, count: number): number {
  return (((index + delta) % count) + count) % count;
}

export function createShowcase(
  root: HTMLElement,
  { autoplay, interval = 5000, labels }: ShowcaseOptions,
): () => void {
  const slides = [...root.querySelectorAll<HTMLElement>("[data-slide]")];
  const counter = root.querySelector<HTMLElement>("[data-counter]");
  const title = root.querySelector<HTMLElement>("[data-card-title]");
  const caption = root.querySelector<HTMLElement>("[data-card-caption]");
  const card = root.querySelector<HTMLElement>("[data-card]");
  const toggle = root.querySelector<HTMLButtonElement>("[data-autoplay]");
  if (slides.length === 0) return () => {};

  const listeners = new AbortController();
  const { signal } = listeners;
  let current = 0;
  let playing = autoplay;
  let hovered = false;
  let focused = false;
  let inView = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function load(index: number) {
    slides[index]
      .querySelectorAll<HTMLImageElement | HTMLSourceElement>("[data-srcset]")
      .forEach((element) => {
        element.srcset = element.dataset.srcset ?? "";
        element.removeAttribute("data-srcset");
      });
  }

  function schedule() {
    clearTimeout(timer);
    timer = undefined;
    if (playing && inView && !hovered && !focused && !document.hidden) {
      timer = setTimeout(() => show(step(current, 1, slides.length)), interval);
    }
    card?.setAttribute("aria-live", playing ? "off" : "polite");
    if (toggle) {
      toggle.dataset.state = playing ? "pause" : "play";
      toggle.setAttribute("aria-label", playing ? labels.pause : labels.play);
    }
  }

  function show(index: number) {
    current = index;
    load(index);
    load(step(index, 1, slides.length));
    slides.forEach((slide, position) => {
      const active = position === index;
      slide.toggleAttribute("data-active", active);
      slide.setAttribute("aria-hidden", String(!active));
    });
    if (counter)
      counter.textContent = labels.position(index + 1, slides.length);
    if (title) title.textContent = slides[index].dataset.title ?? "";
    if (caption) caption.textContent = slides[index].dataset.caption ?? "";
    schedule();
  }

  function move(delta: number) {
    show(step(current, delta, slides.length));
  }

  root
    .querySelector("[data-prev]")
    ?.addEventListener("click", () => move(-1), { signal });
  root
    .querySelector("[data-next]")
    ?.addEventListener("click", () => move(1), { signal });
  toggle?.addEventListener(
    "click",
    () => {
      playing = !playing;
      schedule();
    },
    { signal },
  );
  root.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "ArrowRight") move(1);
      else if (event.key === "ArrowLeft") move(-1);
      else return;
      event.preventDefault();
    },
    { signal },
  );
  root.addEventListener("pointerenter", () => ((hovered = true), schedule()), {
    signal,
  });
  root.addEventListener("pointerleave", () => ((hovered = false), schedule()), {
    signal,
  });
  root.addEventListener("focusin", () => ((focused = true), schedule()), {
    signal,
  });
  root.addEventListener(
    "focusout",
    (event) => {
      if (!root.contains(event.relatedTarget as Node | null)) {
        focused = false;
        schedule();
      }
    },
    { signal },
  );
  document.addEventListener("visibilitychange", schedule, { signal });

  let startX: number | null = null;
  root.addEventListener("pointerdown", (event) => (startX = event.clientX), {
    signal,
  });
  root.addEventListener(
    "pointerup",
    (event) => {
      if (startX === null) return;
      const dx = event.clientX - startX;
      startX = null;
      if (Math.abs(dx) > 50) move(dx < 0 ? 1 : -1);
    },
    { signal },
  );

  const observer = new IntersectionObserver(
    (entries) => {
      inView = entries.some((entry) => entry.isIntersecting);
      schedule();
    },
    { threshold: 0.4 },
  );
  observer.observe(root);
  show(0);

  return () => {
    clearTimeout(timer);
    listeners.abort();
    observer.disconnect();
  };
}
