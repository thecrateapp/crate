import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
const meta = {
  id: "components-statusdot",
  title: "Components/Feedback/StatusDot",
  component: StatusDot,
  args: { tone: "on", label: "Available", pulse: false },
  argTypes: {
    tone: { control: "radio", options: ["on", "off", "warn"] },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof StatusDot>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const States: Story = {
  render: () => (
    <div className="showcase-line">
      <StatusDot label="Available" />
      <StatusDot tone="off" label="Disabled" />
      <StatusDot tone="warn" label="Needs attention" />
      <StatusDot title="Processing" pulse />
    </div>
  ),
};
