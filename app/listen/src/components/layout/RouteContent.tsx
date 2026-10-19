import { useEffect, useRef, type ReactNode } from "react";
import { isMotionBlocked } from "@crate/ui/lib/motion-gate";

/** Focus the new page identity once it has settled; leave tab/filter navigation alone. */
export function RouteContent({
  pathname,
  children,
}: {
  pathname: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const pageIdentity =
    pathname === "/library" ||
    pathname === "/collection" ||
    pathname.startsWith("/collection/")
      ? "/library"
      : pathname;
  const previous = useRef(pageIdentity);
  useEffect(() => {
    if (previous.current === pageIdentity) return;
    previous.current = pageIdentity;
    const node = root.current;
    if (!node) return;
    let settled = isMotionBlocked(),
      cancelled = false;
    const finish = () => {
      if (!settled || cancelled) return;
      const heading = node.querySelector<HTMLHeadingElement>("h1");
      if (!heading) return;
      if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      observer.disconnect();
    };
    const observer = new MutationObserver(finish);
    observer.observe(node, { childList: true, subtree: true });
    const cancel = () => {
      cancelled = true;
      observer.disconnect();
    };
    document.addEventListener("pointerdown", cancel, true);
    document.addEventListener("keydown", cancel, true);
    node.classList.remove("listen-route-enter");
    if (!settled) {
      void node.offsetWidth;
      node.classList.add("listen-route-enter");
    }
    const timer = window.setTimeout(
      () => {
        settled = true;
        finish();
      },
      settled ? 0 : 350,
    );
    const expiry = window.setTimeout(cancel, 8000);
    return () => {
      cancel();
      window.clearTimeout(timer);
      window.clearTimeout(expiry);
      node.classList.remove("listen-route-enter");
      document.removeEventListener("pointerdown", cancel, true);
      document.removeEventListener("keydown", cancel, true);
    };
  }, [pageIdentity]);
  return <div ref={root}>{children}</div>;
}
