import type { Meta, StoryObj } from "@storybook/react-vite";
import { Progress } from "@crate/ui/shadcn/progress";
import { RadixProgressStates } from "../fixtures/ProgressUpcomingSamples";
const meta = {
  id: "components-progress",
  title: "Components/Feedback/Progress",
  component: Progress,
  args: { value: 50, "aria-label": "Transfer progress" },
} satisfies Meta<typeof Progress>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const RangesAndUnknown: Story = {
  render: () => <RadixProgressStates />,
};
