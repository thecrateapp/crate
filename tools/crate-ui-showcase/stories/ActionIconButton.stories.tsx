import type { Meta, StoryObj } from "@storybook/react-vite";
import { Eye } from "@crate/ui/icons";
import {
  ActionIconButton,
  ActionIconLink,
} from "@crate/ui/primitives/ActionIconButton";
const meta = {
  id: "components-actioniconbutton",
  title: "Components/Compatibility/ActionIconButton",
  component: ActionIconButton,
  args: {
    "aria-label": "Preview playlist",
    children: <Eye aria-hidden="true" />,
    variant: "row",
    tone: "default",
    disabled: false,
    active: false,
  },
  argTypes: {
    variant: { control: "select", options: ["row", "card"] },
    tone: { control: "select", options: ["default", "primary", "danger"] },
    children: { table: { disable: true } },
  },
} satisfies Meta<typeof ActionIconButton>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Card: Story = { args: { variant: "card" } };
export const Disabled: Story = { args: { disabled: true } };
export const Active: Story = { args: { active: true } };
export const Link: Story = {
  render: () => (
    <ActionIconLink href="#preview" aria-label="Preview playlist">
      <Eye aria-hidden="true" />
    </ActionIconLink>
  ),
};
export const DisabledLink: Story = {
  render: () => (
    <ActionIconLink disabled href="#preview" aria-label="Preview playlist">
      <Eye aria-hidden="true" />
    </ActionIconLink>
  ),
};
