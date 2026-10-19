import type { Meta, StoryObj } from "@storybook/react-vite";
import { Separator } from "@crate/ui/shadcn/separator";
const meta = {
  id: "components-separator",
  title: "Components/Layout/Separator",
  component: Separator,
  args: { orientation: "horizontal", decorative: true },
  argTypes: {
    orientation: { control: "radio", options: ["horizontal", "vertical"] },
    decorative: { control: "boolean" },
  },
} satisfies Meta<typeof Separator>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Vertical: Story = {
  args: { orientation: "vertical" },
  decorators: [
    (Story) => (
      <div className="h-20">
        <Story />
      </div>
    ),
  ],
};
export const Semantic: Story = {
  args: { decorative: false, "aria-label": "Between sections" },
};
