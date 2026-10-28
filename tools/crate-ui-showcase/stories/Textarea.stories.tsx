import type { Meta, StoryObj } from "@storybook/react-vite";
import { FormField } from "@crate/ui/primitives/FormField";
import { Textarea } from "@crate/ui/shadcn/textarea";
const meta = {
  id: "components-textarea",
  title: "Components/Forms/Textarea",
  component: Textarea,
  args: {
    defaultValue: "A selection for late listening.",
    rows: 3,
    placeholder: "Description",
  },
  argTypes: {
    className: { table: { disable: true } },
    disabled: { control: "boolean" },
    readOnly: { control: "boolean" },
  },
  render: (args) => (
    <FormField label="Description">
      <Textarea {...args} />
    </FormField>
  ),
} satisfies Meta<typeof Textarea>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const ReadOnly: Story = {
  args: { readOnly: true, defaultValue: "Saved value" },
};
export const Invalid: Story = {
  render: (args) => (
    <FormField
      label="Textarea value"
      error="Check this value"
      hint="The existing value is preserved."
    >
      <Textarea {...args} />
    </FormField>
  ),
};
