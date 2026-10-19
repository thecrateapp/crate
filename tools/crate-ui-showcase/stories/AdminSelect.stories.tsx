import type { Meta, StoryObj } from "@storybook/react-vite";
import { FormField } from "@crate/ui/primitives/FormField";
import { useArgs } from "storybook/preview-api";
import { AdminSelect } from "@crate/ui/composites/AdminSelect";
const options = [
  { value: "ambient", label: "Ambient", count: 0, searchText: "drone" },
  { value: "jazz", label: "Jazz", count: 12 },
  { value: "folk", label: "Folk", count: "50+" },
  {
    value: "long",
    label: "A long translated option that must fit inside its menu",
  },
];
const meta = {
  id: "components-adminselect",
  title: "Components/Forms/AdminSelect",
  component: AdminSelect,
  args: {
    onChange: () => {},
    value: "jazz",
    placeholder: "Choose a genre",
    options,
    searchable: true,
    allowClear: true,
    searchPlaceholder: "Search genres",
    noMatchesLabel: "No matching genres",
  },
  render: function Example(args) {
    const [current, updateArgs] = useArgs<typeof args>();
    return (
      <FormField label="Genre">
        {(control) => (
          <AdminSelect
            {...control}
            {...args}
            value={current.value}
            onChange={(value) => updateArgs({ value })}
          />
        )}
      </FormField>
    );
  },
} satisfies Meta<typeof AdminSelect>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Plain: Story = { args: { searchable: false } };
export const Disabled: Story = { args: { disabled: true } };
export const Empty: Story = { args: { options: [], value: "" } };
export const UnknownValue: Story = { args: { value: "unknown" } };
export const Validation: Story = {
  render: (args) => (
    <FormField
      label="Genre"
      required
      error="Choose an available genre"
      hint="Search by name or alias."
    >
      {(control) => <AdminSelect {...control} {...args} />}
    </FormField>
  ),
};
