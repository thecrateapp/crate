import type { Meta, StoryObj } from "@storybook/react-vite";
import { Readout } from "@crate/ui/primitives/Readout";
const meta = {
  id: "components-readout",
  title: "Components/Data Display/Readout",
  component: Readout,
  args: {
    children: "Flat · 0 dB",
    announcement: "Flat preset committed",
    minWidthCh: 20,
  },
} satisfies Meta<typeof Readout>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Long: Story = {
  args: {
    children: "A long readout that can wrap in its container",
    minWidthCh: 0,
  },
};
