import type { Meta, StoryObj } from "@storybook/react-vite";
import { CloseControlExample } from "../reviews/WebClosureSamples";
const meta = {
  id: "components-overlayclosebutton",
  title: "Components/Actions/OverlayCloseButton",
  component: CloseControlExample,
  parameters: { layout: "padded" },
} satisfies Meta<typeof CloseControlExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Disabled: Story = { args: { disabled: true } };
