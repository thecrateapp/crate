import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "@crate/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type DialogContentSize,
} from "@crate/ui/shadcn/dialog";

function DialogExample({ size }: { size?: DialogContentSize }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>Open {size ?? "md"} dialog</Button>
      <DialogContent size={size}>
        <DialogHeader>
          <DialogTitle>Merge into canonical artist</DialogTitle>
          <DialogDescription>
            Local review data. The dialog width comes from its size, never from
            caller width classes.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => setOpen(false)}>Merge</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const meta = {
  id: "components-dialog",
  title: "Components/Overlays/Dialog",
  component: DialogExample,
  args: { size: "md" },
  argTypes: {
    size: {
      control: "select",
      options: ["sm", "md", "lg", "xl", "2xl", "3xl"],
    },
  },
} satisfies Meta<typeof DialogExample>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Base: Story = {};

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {(["sm", "md", "lg", "xl", "2xl", "3xl"] as const).map((size) => (
        <DialogExample key={size} size={size} />
      ))}
    </div>
  ),
};
