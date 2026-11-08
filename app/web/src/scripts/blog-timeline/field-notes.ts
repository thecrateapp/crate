import { reducedMotion } from "../motion/env";

export function initFieldNotes(): () => void {
  const root = document.querySelector<HTMLElement>(
    '[data-timeline-proposal="field-notes"]',
  );
  if (!root) return () => {};

  const entries = [
    ...root.querySelectorAll<HTMLElement>("[data-milestone-id]"),
  ];
  const selectors = [
    ...root.querySelectorAll<HTMLButtonElement>("[data-note-select]"),
  ];
  const eras = [
    ...root.querySelectorAll<HTMLButtonElement>("[data-era-index]"),
  ];
  const eraNav = root.querySelector<HTMLElement>("[data-note-era-nav]");
  const previous = root.querySelector<HTMLButtonElement>(
    "[data-note-previous]",
  );
  const next = root.querySelector<HTMLButtonElement>("[data-note-next]");
  const position = root.querySelector<HTMLElement>("[data-note-position]");
  const rail = root.querySelector<HTMLElement>("[data-note-entries]");
  if (!entries.length || !rail) return () => {};

  const abort = new AbortController();
  const options = { signal: abort.signal };
  let selected = 0;
  let frame = 0;

  const updateProgress = () => {
    frame = 0;
    const bounds = rail.getBoundingClientRect();
    if (bounds.height <= 0 || bounds.width <= 0) return;
    const progress = Math.min(
      1,
      Math.max(
        0,
        (window.innerHeight * 0.55 - bounds.top) / Math.max(1, bounds.height),
      ),
    );
    rail.style.setProperty("--note-progress", String(progress));
  };

  const queueProgress = () => {
    if (!frame) frame = window.requestAnimationFrame(updateProgress);
  };

  const revealSelectedEra = () => {
    const active = eras.find(
      (button) => button.getAttribute("aria-pressed") === "true",
    );
    if (!eraNav || !active || !eraNav.clientWidth || !eraNav.clientHeight)
      return;
    const bounds = eraNav.getBoundingClientRect();
    const button = active.getBoundingClientRect();
    if (button.top < bounds.top) eraNav.scrollTop -= bounds.top - button.top;
    else if (button.bottom > bounds.bottom)
      eraNav.scrollTop += button.bottom - bounds.bottom;
    if (button.left < bounds.left)
      eraNav.scrollLeft -= bounds.left - button.left;
    else if (button.right > bounds.right)
      eraNav.scrollLeft += button.right - bounds.right;
  };

  const select = (index: number, navigate = false, focus = false) => {
    selected = Math.max(0, Math.min(entries.length - 1, index));
    entries.forEach((entry, entryIndex) => {
      const active = entryIndex === selected;
      entry.classList.toggle("is-selected", active);
      const detail = entry.querySelector<HTMLElement>("[data-note-detail]");
      if (detail) detail.hidden = !active;
      const button = selectors[entryIndex];
      button?.setAttribute("aria-pressed", String(active));
      button?.setAttribute("aria-expanded", String(active));
    });

    const activeEntry = entries[selected];
    root.dataset.selectedMilestone = activeEntry?.dataset.milestoneId;
    const era = activeEntry?.dataset.noteEra;
    eras.forEach((button) => {
      const target = entries[Number(button.dataset.eraIndex)];
      button.setAttribute(
        "aria-pressed",
        String(target?.dataset.noteEra === era),
      );
    });
    revealSelectedEra();
    if (position) position.textContent = String(selected + 1).padStart(2, "0");
    if (previous) previous.disabled = selected === 0;
    if (next) next.disabled = selected === entries.length - 1;
    activeEntry?.setAttribute("data-seen", "");

    if (focus) selectors[selected]?.focus({ preventScroll: true });
    if (navigate) {
      activeEntry?.scrollIntoView({
        block: "nearest",
        behavior: reducedMotion() ? "auto" : "smooth",
      });
    }
    queueProgress();
  };

  selectors.forEach((button, index) => {
    button.addEventListener("click", () => select(index), options);
    button.addEventListener(
      "keydown",
      (event) => {
        let target: number;
        switch (event.key) {
          case "ArrowDown":
          case "ArrowRight":
            target = index + 1;
            break;
          case "ArrowUp":
          case "ArrowLeft":
            target = index - 1;
            break;
          case "Home":
            target = 0;
            break;
          case "End":
            target = entries.length - 1;
            break;
          default:
            return;
        }
        event.preventDefault();
        select(target, true, true);
      },
      options,
    );
  });

  eras.forEach((button) => {
    button.addEventListener(
      "click",
      () => select(Number(button.dataset.eraIndex), true),
      options,
    );
  });
  previous?.addEventListener(
    "click",
    () => select(selected - 1, true),
    options,
  );
  next?.addEventListener("click", () => select(selected + 1, true), options);

  root.setAttribute("data-enhanced", "");
  select(0);

  const observer = new IntersectionObserver(
    (observations) => {
      observations.forEach((observation) => {
        if (!observation.isIntersecting) return;
        observation.target.setAttribute("data-seen", "");
        observer.unobserve(observation.target);
      });
    },
    { rootMargin: "0px 0px -5% 0px", threshold: 0.05 },
  );
  entries.forEach((entry) => observer.observe(entry));

  const resizeObserver =
    typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(queueProgress);
  resizeObserver?.observe(rail);

  const onProposalChange = (event: Event) => {
    const proposal = (event as CustomEvent<{ proposal?: string }>).detail
      ?.proposal;
    if (proposal !== "field-notes") return;
    revealSelectedEra();
    queueProgress();
  };

  window.addEventListener("scroll", queueProgress, {
    ...options,
    passive: true,
  });
  window.addEventListener("resize", queueProgress, options);
  window.addEventListener("crate:timeline-proposal", onProposalChange, options);
  document.addEventListener(
    "crate:timeline-proposal",
    onProposalChange,
    options,
  );

  return () => {
    abort.abort();
    observer.disconnect();
    resizeObserver?.disconnect();
    if (frame) window.cancelAnimationFrame(frame);
    root.removeAttribute("data-enhanced");
    entries.forEach((entry) => {
      const detail = entry.querySelector<HTMLElement>("[data-note-detail]");
      if (detail) detail.hidden = false;
    });
  };
}
