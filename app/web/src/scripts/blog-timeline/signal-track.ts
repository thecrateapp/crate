import type { Cleanup } from "../motion/page";
import { initialTimelineIndex } from "../../lib/engineering-timeline";

export function initSignalTrack(root: HTMLElement): Cleanup {
  const stops = [
    ...root.querySelectorAll<HTMLButtonElement>("[data-track-stop]"),
  ];
  const details = [
    ...root.querySelectorAll<HTMLElement>("[data-track-detail]"),
  ];
  const periods = [
    ...root.querySelectorAll<HTMLButtonElement>("[data-track-period]"),
  ];
  const rail = root.querySelector<HTMLElement>(".track-rail")!;
  const indicator = root.querySelector<HTMLElement>("[data-track-indicator]")!;
  const viewport = root.querySelector<HTMLElement>("[data-track-viewport]")!;
  const previous = root.querySelector<HTMLButtonElement>(
    "[data-track-previous]",
  )!;
  const next = root.querySelector<HTMLButtonElement>("[data-track-next]")!;
  const count = root.querySelector<HTMLElement>("[data-track-count]")!;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const disclosure = root.closest<HTMLDetailsElement>("[data-series-browser]");
  const controller = new AbortController();
  const options = { signal: controller.signal };
  let selected = 0;
  let animation: Animation | undefined;
  let scrollFrame: number | undefined;
  let indicatorX = 0;
  let clickReset: number | undefined;
  let suppressClick = false;
  let drag:
    | { pointerId: number; x: number; y: number; left: number; active: boolean }
    | undefined;

  const paintIndicator = (x: number) => {
    indicatorX = x;
    indicator.style.transform = `translateX(${x}px)`;
    const last = stops.at(-1)!.parentElement!.offsetLeft;
    rail.style.setProperty("--progress", String(last ? x / last : 0));
  };

  const cancelScroll = (settleIndicator = false) => {
    if (scrollFrame !== undefined) window.cancelAnimationFrame(scrollFrame);
    scrollFrame = undefined;
    delete root.dataset.travelling;
    if (settleIndicator)
      paintIndicator(stops[selected]!.parentElement!.offsetLeft);
  };

  const centerSelected = (instant = false) => {
    cancelScroll();
    if (!viewport.clientWidth) return;
    const stop = stops[selected]!;
    const fromX = indicatorX;
    const targetX = stop.parentElement!.offsetLeft;
    indicator.style.width = `${stop.offsetWidth}px`;
    indicator.style.height = `${stop.offsetHeight}px`;
    const left = viewport.scrollLeft;
    const centered =
      left +
      stop.getBoundingClientRect().left -
      viewport.getBoundingClientRect().left +
      stop.offsetWidth / 2 -
      viewport.clientWidth / 2;
    const target = Math.max(
      0,
      Math.min(viewport.scrollWidth - viewport.clientWidth, centered),
    );
    if (
      instant ||
      reduced.matches ||
      (Math.abs(target - left) < 1 && Math.abs(targetX - fromX) < 1)
    ) {
      viewport.scrollLeft = target;
      paintIndicator(targetX);
      return;
    }
    const start = performance.now();
    const duration = Math.min(680, 420 + Math.abs(targetX - fromX) * 0.07);
    root.dataset.travelling = "true";
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased =
        progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
      viewport.scrollLeft = left + (target - left) * eased;
      paintIndicator(fromX + (targetX - fromX) * eased);
      scrollFrame =
        progress < 1 ? window.requestAnimationFrame(tick) : undefined;
      if (progress === 1) delete root.dataset.travelling;
    };
    scrollFrame = window.requestAnimationFrame(tick);
  };

  const select = (index: number, focus = false, instant = false) => {
    const nextIndex = Math.max(0, Math.min(stops.length - 1, index));
    const changed = selected !== nextIndex;
    selected = nextIndex;
    root.dataset.selectedMilestone = stops[selected]!.dataset.milestoneId;
    stops.forEach((stop, i) => {
      stop.setAttribute("aria-pressed", String(i === selected));
      stop.classList.toggle("is-selected", i === selected);
      stop.classList.toggle("is-past", i < selected);
      stop.tabIndex = i === selected ? 0 : -1;
      details[i]!.hidden = i !== selected;
    });
    const activePeriod = periods.findLast(
      (button) => Number(button.dataset.trackPeriod) <= selected,
    );
    periods.forEach((button) =>
      button.setAttribute("aria-pressed", String(button === activePeriod)),
    );
    rail.style.setProperty("--selected", String(selected));
    count.textContent = String(selected + 1).padStart(2, "0");
    previous.disabled = selected === 0;
    next.disabled = selected === stops.length - 1;
    if (focus) stops[selected]!.focus({ preventScroll: true });
    centerSelected(instant);
    animation?.cancel();
    if (changed && !instant && !reduced.matches && viewport.clientWidth > 0) {
      animation = details[selected]!.animate(
        [
          { opacity: 0.35, transform: "translateY(6px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 220, easing: "ease-out" },
      );
    }
  };

  const finishDrag = () => {
    if (!drag) return;
    const { pointerId, active } = drag;
    drag = undefined;
    delete viewport.dataset.dragging;
    if (viewport.hasPointerCapture(pointerId))
      viewport.releasePointerCapture(pointerId);
    if (active) {
      // pointerup is followed by click; the drag must not activate its starting milestone.
      suppressClick = true;
      clickReset = window.setTimeout(() => {
        suppressClick = false;
      }, 0);
    }
  };

  viewport.addEventListener(
    "pointerdown",
    (event) => {
      // Keep travel running until a mouse gesture is known to be a drag.
      // A click can then retarget the cursor from its current position.
      if (event.pointerType !== "mouse") cancelScroll(true);
      if (
        event.pointerType !== "mouse" ||
        event.button !== 0 ||
        !event.isPrimary
      )
        return;
      window.clearTimeout(clickReset);
      suppressClick = false;
      drag = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: viewport.scrollLeft,
        active: false,
      };
    },
    options,
  );
  window.addEventListener(
    "pointermove",
    (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.active) {
        if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
          finishDrag();
          return;
        }
        if (Math.abs(dx) <= 8 || Math.abs(dx) < Math.abs(dy)) return;
        drag.active = true;
        cancelScroll(true);
        viewport.dataset.dragging = "true";
        viewport.setPointerCapture(event.pointerId);
      }
      event.preventDefault();
      viewport.scrollLeft = drag.left - dx;
    },
    options,
  );
  window.addEventListener(
    "pointerup",
    (event) => {
      if (event.pointerId === drag?.pointerId) finishDrag();
    },
    options,
  );
  window.addEventListener(
    "pointercancel",
    (event) => {
      if (event.pointerId === drag?.pointerId) finishDrag();
    },
    options,
  );
  viewport.addEventListener("lostpointercapture", finishDrag, options);
  window.addEventListener("blur", finishDrag, options);
  viewport.addEventListener(
    "click",
    (event) => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
    },
    { ...options, capture: true },
  );
  viewport.addEventListener("wheel", () => cancelScroll(true), {
    ...options,
    passive: true,
  });

  stops.forEach((stop, i) => {
    stop.addEventListener("click", () => select(i), options);
    stop.addEventListener(
      "keydown",
      (event) => {
        const target =
          event.key === "ArrowRight"
            ? i + 1
            : event.key === "ArrowLeft"
              ? i - 1
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? stops.length - 1
                  : undefined;
        if (target === undefined) return;
        event.preventDefault();
        select(target, true);
      },
      options,
    );
  });
  periods.forEach((period, index) => {
    period.addEventListener(
      "click",
      () => select(Number(period.dataset.trackPeriod)),
      options,
    );
    period.addEventListener(
      "keydown",
      (event) => {
        const target =
          event.key === "ArrowRight"
            ? index + 1
            : event.key === "ArrowLeft"
              ? index - 1
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? periods.length - 1
                  : undefined;
        if (target === undefined) return;
        event.preventDefault();
        const destination =
          periods[Math.max(0, Math.min(periods.length - 1, target))]!;
        destination.focus({ preventScroll: true });
        select(Number(destination.dataset.trackPeriod));
      },
      options,
    );
  });
  previous.addEventListener("click", () => select(selected - 1), options);
  next.addEventListener("click", () => select(selected + 1), options);
  reduced.addEventListener(
    "change",
    () => {
      animation?.cancel();
      centerSelected(true);
    },
    options,
  );
  window.addEventListener("resize", () => centerSelected(true), options);
  window.addEventListener(
    "crate:timeline-proposal",
    () => {
      cancelScroll();
      animation?.cancel();
      finishDrag();
      if (viewport.clientWidth > 0) centerSelected(true);
    },
    options,
  );
  const revealFromHash = () => {
    if (disclosure && window.location.hash === `#${disclosure.id}`)
      disclosure.open = true;
  };
  disclosure?.addEventListener(
    "toggle",
    () => {
      cancelScroll();
      animation?.cancel();
      finishDrag();
      if (disclosure.open) centerSelected(true);
    },
    options,
  );
  window.addEventListener("hashchange", revealFromHash, options);
  const requested = new URLSearchParams(window.location.search).getAll(
    "milestone",
  );
  const initialIndex = root.dataset.currentPostHref
    ? initialTimelineIndex(
        stops.map((stop) => ({
          id: stop.dataset.milestoneId!,
          href: stop.dataset.articleHref,
        })),
        root.dataset.currentPostHref,
        requested.length === 1 ? requested[0] : undefined,
      )
    : Number(root.dataset.initialIndex ?? 0);
  select(initialIndex, false, true);
  revealFromHash();
  return () => {
    controller.abort();
    finishDrag();
    window.clearTimeout(clickReset);
    cancelScroll();
    animation?.cancel();
  };
}
