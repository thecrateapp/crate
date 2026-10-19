import type { Meta, StoryObj } from "@storybook/react-vite";
import { FormField } from "@crate/ui/primitives/FormField";
import { useArgs } from "storybook/preview-api";
import { Switch } from "@crate/ui/primitives/Switch";
const meta = {
  id: "components-switch",
  title: "Components/Forms/Switch",
  component: Switch,
  args: { checked: false, disabled: false },
  argTypes: {
    checked: { control: "boolean" },
    className: { table: { disable: true } },
  },
  render: function Example(args) {
    const [current, updateArgs] = useArgs<typeof args>();
    return (
      <FormField layout="inline" label="Automatic playback">
        <Switch
          {...args}
          checked={current.checked}
          onCheckedChange={(checked) => updateArgs({ checked })}
        />
      </FormField>
    );
  },
} satisfies Meta<typeof Switch>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Checked: Story = { args: { checked: true } };
export const Disabled: Story = { args: { disabled: true, checked: true } };
export const Invalid: Story = { args: { "aria-invalid": true } };
export const Small: Story = { args: { size: "sm" } };
