import { reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";

export function initSystemMapTimeline(scope: ParentNode = document): Cleanup {
  const cleanups: Cleanup[] = [];

  scope
    .querySelectorAll<HTMLElement>('[data-timeline-proposal="system-map"]')
    .forEach((root) => {
      const panels = [
        ...root.querySelectorAll<HTMLElement>("[data-milestone-id]"),
      ];
      const nodes = [...root.querySelectorAll<HTMLElement>("[data-system]")];
      const range = root.querySelector<HTMLInputElement>(
        "[data-milestone-range]",
      );
      const select = root.querySelector<HTMLSelectElement>(
        "[data-milestone-select]",
      );
      const previous = root.querySelector<HTMLButtonElement>(
        "[data-map-previous]",
      );
      const next = root.querySelector<HTMLButtonElement>("[data-map-next]");
      if (!panels.length || !range || !select || !previous || !next) return;

      let current = Math.max(
        0,
        panels.findIndex((panel) => !panel.hidden),
      );
      let animations: Animation[] = [];
      const listeners: Cleanup[] = [];
      const listen = (
        element: EventTarget,
        event: string,
        callback: EventListener,
      ) => {
        element.addEventListener(event, callback);
        listeners.push(() => element.removeEventListener(event, callback));
      };
      const stopAnimations = () => {
        animations.forEach((animation) => animation.cancel());
        animations = [];
      };
      const systemsFor = (index: number) =>
        new Set(
          (panels[index]?.dataset.systems ?? "").split(",").filter(Boolean),
        );

      const render = (index: number, animate = true) => {
        const selected = Math.min(panels.length - 1, Math.max(0, index));
        const activeSystems = systemsFor(selected);
        const precedingSystems = systemsFor(selected - 1);
        stopAnimations();
        current = selected;
        range.value = String(selected);
        select.value = String(selected);
        previous.disabled = selected === 0;
        next.disabled = selected === panels.length - 1;
        panels.forEach((panel, panelIndex) => {
          panel.hidden = panelIndex !== selected;
        });
        const panel = panels[selected];
        root.dataset.selectedMilestone = panel.dataset.milestoneId;
        range.setAttribute(
          "aria-valuetext",
          `${panel.dataset.dateLabel}: ${panel.dataset.title}`,
        );
        const era = root.querySelector<HTMLElement>("[data-map-era]");
        const count = root.querySelector<HTMLElement>("[data-system-count]");
        const position = root.querySelector<HTMLElement>("[data-map-position]");
        if (era) era.textContent = panel.dataset.era ?? "";
        if (count) count.textContent = String(activeSystems.size);
        if (position)
          position.textContent = `${String(selected + 1).padStart(2, "0")} / ${String(panels.length).padStart(2, "0")}`;
        root
          .querySelectorAll<HTMLElement>("[data-map-tick]")
          .forEach((tick, tickIndex) => {
            tick.dataset.passed = String(tickIndex <= selected);
          });

        nodes.forEach((node, nodeIndex) => {
          const system = node.dataset.system ?? "";
          const active = activeSystems.has(system);
          const state = active
            ? precedingSystems.has(system)
              ? "present"
              : "added"
            : "later";
          const changed = node.dataset.state !== state;
          node.dataset.state = state;
          const status = node.querySelector<HTMLElement>("[data-node-status]");
          if (status)
            status.textContent =
              state === "added"
                ? "Added"
                : state === "present"
                  ? "Present"
                  : "Later";
          if (
            !animate ||
            !changed ||
            !active ||
            reducedMotion() ||
            typeof node.animate !== "function"
          )
            return;
          animations.push(
            node.animate(
              [
                { opacity: 0.5, transform: "translateY(5px)" },
                { opacity: 1, transform: "translateY(0)" },
              ],
              {
                duration: 380,
                delay: nodeIndex * 24,
                easing: "cubic-bezier(0.16, 1, 0.3, 1)",
              },
            ),
          );
          const connection = node.querySelector<SVGPathElement>(
            ".system-connection path",
          );
          if (connection && typeof connection.animate === "function") {
            animations.push(
              connection.animate(
                [
                  { strokeDasharray: "1", strokeDashoffset: "1" },
                  { strokeDasharray: "1", strokeDashoffset: "0" },
                ],
                { duration: 450, delay: nodeIndex * 24, easing: "ease-out" },
              ),
            );
          }
        });
      };

      listen(range, "input", () => render(Number(range.value)));
      listen(select, "change", () => render(Number(select.value)));
      listen(previous, "click", () => render(current - 1));
      listen(next, "click", () => render(current + 1));
      const motionPreference = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      );
      listen(motionPreference, "change", () => {
        if (motionPreference.matches) stopAnimations();
      });
      render(current, false);
      cleanups.push(() => {
        stopAnimations();
        listeners.forEach((cleanup) => cleanup());
      });
    });

  return () => cleanups.forEach((cleanup) => cleanup());
}
