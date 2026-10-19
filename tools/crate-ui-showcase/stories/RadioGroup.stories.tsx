import type { Meta, StoryObj } from "@storybook/react-vite";
import { FormField } from "@crate/ui/primitives/FormField";
import { useArgs } from "storybook/preview-api";
import { RadioGroup, RadioGroupItem } from "@crate/ui/primitives/RadioGroup";
const meta = {
  id: "components-radiogroup",
  title: "Components/Forms/RadioGroup",
  component: RadioGroup,
  args: { value: "lossless", disabled: false },
  render: function Example(args) {
    const [current, updateArgs] = useArgs<typeof args>();
    return (
      <FormField kind="group" label="Audio quality">
        {(control) => (
          <RadioGroup
            {...control}
            {...args}
            value={current.value}
            onValueChange={(value) => updateArgs({ value })}
          >
            <FormField layout="inline" label="Lossless">
              <RadioGroupItem value="lossless" />
            </FormField>
            <FormField layout="inline" label="Compressed">
              <RadioGroupItem value="compressed" />
            </FormField>
            <FormField layout="inline" label="Unavailable">
              <RadioGroupItem value="unavailable" disabled />
            </FormField>
          </RadioGroup>
        )}
      </FormField>
    );
  },
} satisfies Meta<typeof RadioGroup>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const Invalid: Story = { args: { "aria-invalid": true } };
