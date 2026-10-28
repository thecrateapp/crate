import type { Meta, StoryObj } from "@storybook/react-vite";
import { PullExample } from "../reviews/WebClosureSamples";
const meta = {
  id: "components-pullindicator",
  title: "Components/Feedback/PullIndicator",
  component: PullExample,
  parameters: { layout: "padded" },
} satisfies Meta<typeof PullExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Refreshing: Story = { args: { refreshing: true } };
