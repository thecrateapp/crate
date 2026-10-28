import type { Meta, StoryObj } from "@storybook/react-vite";
import { TooltipExample } from "../reviews/WebClosureSamples";
const meta = {
  id: "components-tooltip",
  title: "Components/Overlays/Tooltip",
  component: TooltipExample,
  parameters: { layout: "padded" },
} satisfies Meta<typeof TooltipExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
