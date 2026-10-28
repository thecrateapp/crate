export type Cleanup = () => void;

export function mountOnPage(selector: string, init: () => Cleanup): void {
  let cleanup: Cleanup | undefined;
  const teardown = () => {
    cleanup?.();
    cleanup = undefined;
  };
  document.addEventListener("astro:page-load", () => {
    teardown();
    if (document.querySelector(selector)) cleanup = init();
  });
  document.addEventListener("astro:before-swap", teardown);
}
