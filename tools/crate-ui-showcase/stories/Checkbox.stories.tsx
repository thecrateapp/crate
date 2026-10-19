import type { Meta, StoryObj } from "@storybook/react-vite";
import { FormField } from "@crate/ui/primitives/FormField";
import { useArgs } from "storybook/preview-api";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
const meta = {
  id: "components-checkbox",
  title: "Components/Forms/Checkbox",
  component: Checkbox,
  args: { checked: false, disabled: false },
  argTypes: {
    checked: { control: "select", options: [false, true, "indeterminate"] },
    className: { table: { disable: true } },
  },
  render: function Example(args) {
    const [current, updateArgs] = useArgs<typeof args>();
    return (
      <FormField layout="inline" label="Keep the queue">
        <Checkbox
          {...args}
          checked={current.checked}
          onCheckedChange={(checked) => updateArgs({ checked })}
        />
      </FormField>
    );
  },
} satisfies Meta<typeof Checkbox>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Checked: Story = { args: { checked: true } };
export const Disabled: Story = { args: { disabled: true, checked: true } };
export const Invalid: Story = { args: { "aria-invalid": true } };
export const Indeterminate: Story = { args: { checked: "indeterminate" } };
