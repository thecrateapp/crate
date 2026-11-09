export type Cleanup = () => void;

export function mountOnPage(selector: string, init: () => Cleanup): void {
  let cleanup: Cleanup | undefined;
  let mountedBody: HTMLElement | undefined;
  const teardown = () => {
    cleanup?.();
    cleanup = undefined;
    mountedBody = undefined;
  };
  const mount = () => {
    // DOM readiness and Astro may both announce the same page. Initialise it once.
    if (mountedBody === document.body) return;
    teardown();
    if (document.querySelector(selector)) {
      cleanup = init();
      mountedBody = document.body;
    }
  };
  document.addEventListener("astro:page-load", mount);
  document.addEventListener("astro:before-swap", teardown);

  // Modules loaded after Astro's initial page-load must still mount. DOMContentLoaded
  // also lets visible content start without waiting for every image to finish loading.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
}
