import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { cn } from "@crate/ui/lib/cn";

function TooltipProvider({
  delayDuration = 400,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

const InsideTooltip = React.createContext(false);

function Tooltip({
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipPrimitive.Root data-slot="tooltip" {...props}>
      <InsideTooltip.Provider value={true}>{children}</InsideTooltip.Provider>
    </TooltipPrimitive.Root>
  );
}

let keyboardInteraction = false;
let trackingInteraction = false;

function trackInteraction() {
  if (trackingInteraction || typeof document === "undefined") return;
  trackingInteraction = true;
  document.addEventListener(
    "keydown",
    (event) => {
      if (!event.metaKey && !event.ctrlKey && !event.altKey) {
        keyboardInteraction = true;
      }
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    () => {
      keyboardInteraction = false;
    },
    true,
  );
}

function TooltipTrigger({
  onFocus,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  React.useEffect(trackInteraction, []);
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      onFocus={(event) => {
        onFocus?.(event);
        if (!keyboardInteraction) event.preventDefault();
      }}
      {...props}
    />
  );
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "crate-overlay-tooltip z-app-popover w-fit origin-(--radix-tooltip-content-transform-origin) px-3 py-1.5 text-balance",
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };

/** Legacy title metadata uses our tooltip, never a browser tooltip. An outer
 * Tooltip already owns the description, so nested controls do not create a second one. */
function TooltipHint({
  content,
  children,
}: {
  content?: React.ReactNode;
  children: React.ReactElement;
}) {
  const inside = React.useContext(InsideTooltip);
  const [open, setOpen] = React.useState(false);
  if (inside) return children;
  return (
    <TooltipProvider>
      <Tooltip
        open={Boolean(content) && open}
        onOpenChange={(next) => setOpen(Boolean(content) && next)}
      >
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        {content ? (
          <TooltipContent side="top" onEscapeKeyDown={() => setOpen(false)}>
            {content}
          </TooltipContent>
        ) : null}
      </Tooltip>
    </TooltipProvider>
  );
}
export { TooltipHint };
