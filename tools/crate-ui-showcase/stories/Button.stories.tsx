import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@crate/ui/shadcn/button";
const meta = {
  id: "components-button",
  title: "Components/Actions/Button",
  component: Button,
  args: {
    children: "Save changes",
    variant: "default",
    size: "default",
    loading: false,
    disabled: false,
  },
  argTypes: {
    variant: {
      control: "select",
      options: [
        "default",
        "outline",
        "secondary",
        "ghost",
        "link",
        "destructive",
        "danger-soft",
      ],
    },
    size: {
      control: "select",
      options: [
        "default",
        "xs",
        "sm",
        "lg",
        "icon",
        "icon-xs",
        "icon-sm",
        "icon-lg",
      ],
    },
    shape: { control: "select", options: ["rect", "pill"] },
  },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const Loading: Story = { args: { loading: true } };
export const Link: Story = {
  render: () => (
    <Button asChild>
      <a href="#destination">Open playlist</a>
    </Button>
  ),
};
export const DisabledLink: Story = {
  render: () => (
    <Button asChild disabled>
      <a href="#destination">Unavailable playlist</a>
    </Button>
  ),
};
