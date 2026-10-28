import { useState } from "react";
import { ContextMenu } from "@crate/ui/domain/actions/ContextMenu";
import { useItemActionMenu } from "@crate/ui/domain/actions/useItemActionMenu";
import { useItemActionTarget } from "@crate/ui/domain/actions/useItemActionTarget";
import type { ContextMenuEntry } from "@crate/ui/domain/actions/types";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Button } from "@crate/ui/shadcn/button";
import { Card, CardContent } from "@crate/ui/shadcn/card";
import { IMAGE_SAMPLES } from "../fixtures/image-identity";

export function ContextMenuExamples({
  longLabels = false,
}: {
  longLabels?: boolean;
}) {
  const [event, setEvent] = useState("No action yet");
  const [expanded, setExpanded] = useState(false);
  const items: ContextMenuEntry[] = [
    {
      key: "queue",
      label: longLabels
        ? "Add this unusually long translated track title to the end of the current playback queue"
        : "Add to queue",
      onSelect: () => setEvent("Added to queue in fixture"),
    },
    {
      key: "playlist",
      type: "disclosure",
      label: "Add to playlist",
      expanded,
      onToggle: () => setExpanded(!expanded),
      items: [
        {
          key: "night",
          label: "Night music",
          onSelect: () => setEvent("Added to Night music in fixture"),
        },
      ],
    },
    {
      key: "unavailable",
      label: "Unavailable action",
      disabled: true,
      onSelect: () => {},
    },
    { key: "divider", type: "divider" },
    {
      key: "remove",
      label: "Remove",
      danger: true,
      onSelect: () => setEvent("Removed in fixture"),
    },
  ];
  const controller = useItemActionMenu(items);
  const target = useItemActionTarget(controller);
  return (
    <div className="grid gap-6">
      <FormField kind="group" label="Context menu target">
        {(props) => (
          <div {...props} role="group" {...target} tabIndex={0}>
            <Card>
              <CardContent>
                <div className="grid gap-4">
                  <MonoLabel>
                    Right click, Shift+F10, menu key or touch long press
                  </MonoLabel>
                  <Button
                    ref={controller.triggerRef}
                    variant="outline"
                    size="lg"
                    aria-haspopup="menu"
                    aria-expanded={controller.open}
                    onClick={controller.openFromTrigger}
                  >
                    Open menu
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </FormField>
      <output aria-live="polite" aria-label="Menu action">
        {event}
      </output>
      <ContextMenu
        open={controller.open}
        position={controller.position}
        menuRef={controller.menuRef}
        onClose={controller.close}
        items={items}
        sheetLabel="Track actions"
        header={{
          type: "media",
          title: "Talk For Hours",
          subtitle: "High Vis",
          detail: "Blending",
          imageUrl: IMAGE_SAMPLES[0],
          imageAlt: "Blending cover",
        }}
      />
    </div>
  );
}
export function ContextMenuReview() {
  return (
    <main className="mx-auto grid max-w-3xl gap-8 p-4 sm:p-6">
      <PageHeader
        title="Context menus"
        eyebrow="1BC · Desktop menu regression"
        subtitle="Fine pointer and hover keep the anchored desktop menu, even when Chrome reports touch points. Touch input retains the action sheet. Fixture actions stay local."
      />
      <ContextMenuExamples />
    </main>
  );
}
