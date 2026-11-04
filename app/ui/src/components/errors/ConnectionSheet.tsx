import type { RefObject } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@crate/ui/shadcn/sheet";

import { ConnectionPanel } from "./ConnectionPanel";

/**
 * The Sentry connection in a right-side drawer, following the agents
 * ConnectionSheet. Several controls can open it, so focus returns to the one
 * that did when it is still on the page, and to `fallbackFocusRef` (the header
 * button) otherwise, for example after saving replaced the empty state.
 */
export function ConnectionSheet({
  open,
  onOpenChange,
  onChanged,
  returnFocusRef,
  fallbackFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-xl"
        onCloseAutoFocus={(event) => {
          const opener = returnFocusRef?.current;
          const target = opener?.isConnected
            ? opener
            : fallbackFocusRef?.current;
          if (!target) return;
          event.preventDefault();
          target.focus();
        }}
      >
        <SheetHeader className="pr-14">
          <SheetTitle className="text-lg">Sentry connection</SheetTitle>
          <SheetDescription>
            Where Crate reads issues from. The token is stored encrypted and
            never shown again.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          <ConnectionPanel onChanged={onChanged} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
