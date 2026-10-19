import type { Meta, StoryObj } from "@storybook/react-vite";
import { FormField } from "@crate/ui/primitives/FormField";
import { useState } from "react";
import { SearchInput } from "@crate/ui/primitives/SearchInput";
const meta = {
  id: "components-searchinput",
  title: "Components/Forms/SearchInput",
  component: SearchInput,
  args: {
    label: "Search library",
    defaultValue: "",
    placeholder: "Artist, album or track",
    debounceMs: 300,
  },
  argTypes: {
    className: { table: { disable: true } },
    disabled: { control: "boolean" },
    readOnly: { control: "boolean" },
  },
  render: (args) => (
    <FormField label="Search library">
      <SearchInput {...args} />
    </FormField>
  ),
} satisfies Meta<typeof SearchInput>;
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
      label="SearchInput value"
      error="Check this value"
      hint="The existing value is preserved."
    >
      <SearchInput {...args} />
    </FormField>
  ),
};
export const Debounce: Story = {
  render: (args) => <SearchExample {...args} />,
};
function SearchExample(args: React.ComponentProps<typeof SearchInput>) {
  const [applied, setApplied] = useState("");
  return (
    <div className="showcase-stack">
      <FormField label="Search library">
        <SearchInput {...args} onDebouncedChange={setApplied} />
      </FormField>
      <output aria-label="Applied query">{applied || "No query"}</output>
    </div>
  );
}
