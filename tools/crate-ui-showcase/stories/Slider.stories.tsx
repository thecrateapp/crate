import type { Meta, StoryObj } from "@storybook/react-vite";
import { Slider } from "@crate/ui/primitives/Slider";
import { FormField } from "@crate/ui/primitives/FormField";
const meta = {
  id: "components-slider",
  title: "Components/Forms/Slider",
  component: Slider,
  args: { min: 0, max: 12, step: 0.5, defaultValue: 4 },
  render: (args) => (
    <FormField
      label="Crossfade"
      hint="General settings range; playback keeps its specialized control."
    >
      <Slider {...args} />
    </FormField>
  ),
} satisfies Meta<typeof Slider>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const Invalid: Story = { args: { "aria-invalid": true } };
