import { PopoverExample } from "../reviews/LayersReview";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { AppPopover } from "@crate/ui/primitives/AppPopover";
const meta = {
  id: "components-apppopover",
  title: "Components/Overlays/AppPopover",
  component: AppPopover,
  args: { children: "Floating content", className: "p-4" },
} satisfies Meta<typeof AppPopover>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = { render: () => <PopoverExample /> };
