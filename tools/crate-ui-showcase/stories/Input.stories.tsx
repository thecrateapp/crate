import type { Meta, StoryObj } from "@storybook/react-vite";
import { FormField } from "@crate/ui/primitives/FormField";
import { Input } from "@crate/ui/shadcn/input";
const meta = {
  id: "components-input",
  title: "Components/Forms/Input",
  component: Input,
  args: {
    defaultValue: "Costa de noche",
    placeholder: "Playlist name",
    type: "text",
  },
  argTypes: {
    className: { table: { disable: true } },
    disabled: { control: "boolean" },
    readOnly: { control: "boolean" },
  },
  render: (args) => (
    <FormField label="Playlist name">
      <Input {...args} />
    </FormField>
  ),
} satisfies Meta<typeof Input>;
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
      label="Input value"
      error="Check this value"
      hint="The existing value is preserved."
    >
      <Input {...args} />
    </FormField>
  ),
};
export const NativeTypes: Story = {
  render: () => (
    <div className="showcase-stack">
      <FormField label="Amount">
        <Input type="number" min={0} max={100} step={1} defaultValue={12} />
      </FormField>
      <FormField label="Password">
        <Input type="password" autoComplete="new-password" />
      </FormField>
      <FormField label="Release date">
        <Input type="date" defaultValue="2026-10-24" />
      </FormField>
      <FormField label="Artwork">
        <Input type="file" accept="image/*" />
      </FormField>
    </div>
  ),
};
