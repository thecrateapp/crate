import type { Meta, StoryObj } from "@storybook/react-vite";
import { Heart } from "@crate/ui/icons";
import { IconButton } from "@crate/ui/primitives/IconButton";
const meta = {
  id: "components-iconbutton",
  title: "Components/Actions/IconButton",
  component: IconButton,
  args: {
    label: "Follow artist",
    children: <Heart aria-hidden="true" />,
    size: "md",
    tone: "default",
    variant: "ghost",
    disabled: false,
    loading: false,
  },
  argTypes: {
    size: { control: "select", options: ["sm", "md", "lg"] },
    tone: { control: "select", options: ["default", "primary", "danger"] },
    variant: { control: "select", options: ["ghost", "card"] },
    children: { table: { disable: true } },
  },
} satisfies Meta<typeof IconButton>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Pressed: Story = { args: { "aria-pressed": true } };
export const Disabled: Story = { args: { disabled: true } };
export const Loading: Story = { args: { loading: true } };
export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      {(["sm", "md", "lg"] as const).map((size) => (
        <IconButton key={size} size={size} label={size}>
          <Heart aria-hidden="true" />
        </IconButton>
      ))}
    </div>
  ),
};
