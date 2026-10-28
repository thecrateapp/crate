"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Tabs as TabsPrimitive } from "radix-ui";

import { cn } from "@crate/ui/lib/cn";

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "group/tabs flex min-w-0 gap-4 data-[orientation=horizontal]:flex-col",
        className,
      )}
      {...props}
    />
  );
}

// Both existing variant names share the V3 text-tab recipe.
const tabsListVariants = cva("crate-tabs-list", {
  variants: { variant: { default: "", line: "" } },
  defaultVariants: { variant: "default" },
});

function TabsList({
  className,
  variant = "default",
  children,
  ref,
  asChild,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  const list = React.useRef<HTMLDivElement>(null);
  const indicator = React.useRef<HTMLSpanElement>(null);
  React.useImperativeHandle(ref, () => list.current!, []);
  React.useLayoutEffect(() => {
    const node = list.current;
    const line = indicator.current;
    if (!node || !line) return;
    let disposed = false;
    let readyFrame = 0;
    const resize =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : null;
    function measure() {
      if (disposed || !node || !line) return;
      const active = node.querySelector<HTMLElement>(
        '[data-slot="tabs-trigger"][data-state="active"]',
      );
      if (!active) {
        delete node.dataset.movingIndicator;
        return;
      }
      const bounds = node.getBoundingClientRect();
      const tab = active.getBoundingClientRect();
      const vertical = node.dataset.orientation === "vertical";
      const rtl = getComputedStyle(node).direction === "rtl";
      const x =
        (vertical ? (rtl ? tab.left : tab.right - 2) : tab.left) -
        bounds.left +
        node.scrollLeft -
        node.clientLeft;
      const y =
        (vertical ? tab.top : tab.bottom - 2) -
        bounds.top +
        node.scrollTop -
        node.clientTop;
      line.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      line.style.width = `${vertical ? 2 : tab.width}px`;
      line.style.height = `${vertical ? tab.height : 2}px`;
      node.dataset.movingIndicator = "true";
      // Track font/count/viewport geometry, not player ticks or React renders.
      node
        .querySelectorAll('[data-slot="tabs-trigger"]')
        .forEach((trigger) => resize?.observe(trigger));
      if (!node.dataset.indicatorReady && !readyFrame)
        readyFrame = requestAnimationFrame(() => {
          node.dataset.indicatorReady = "true";
        });
    }
    const mutation = new MutationObserver(measure);
    mutation.observe(node, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-state", "data-orientation", "dir"],
    });
    resize?.observe(node);
    window.addEventListener("resize", measure);
    void document.fonts?.ready.then(measure);
    measure();
    return () => {
      disposed = true;
      mutation.disconnect();
      resize?.disconnect();
      window.removeEventListener("resize", measure);
      cancelAnimationFrame(readyFrame);
      delete node.dataset.indicatorReady;
    };
  }, [asChild]);
  return (
    <TabsPrimitive.List
      ref={list}
      asChild={asChild}
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    >
      {children}
      {!asChild && (
        <span
          ref={indicator}
          data-slot="tabs-indicator"
          className="crate-tabs-indicator"
          aria-hidden="true"
        />
      )}
    </TabsPrimitive.List>
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "crate-tab-trigger crate-focus-inset font-mono text-eyebrow font-normal tracking-caps uppercase",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("min-w-0 flex-1", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants };
