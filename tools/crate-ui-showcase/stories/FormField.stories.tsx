import type { Meta, StoryObj } from "@storybook/react-vite";
import { FormField } from "@crate/ui/primitives/FormField";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { Input } from "@crate/ui/shadcn/input";
import { Textarea } from "@crate/ui/shadcn/textarea";
const meta = {
  id: "components-formfield",
  title: "Components/Forms/FormField",
  component: FormField,
  args: {
    label: "Playlist name",
    hint: "Use a memorable name.",
    children: <Input defaultValue="Costa de noche" />,
  },
  argTypes: {
    label: { control: "text" },
    hint: { control: "text" },
    error: { control: "text" },
    children: { table: { disable: true } },
    labelClassName: { table: { disable: true } },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof FormField>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Validation: Story = {
  args: { required: true, error: "A name is required." },
};
export const ReadOnly: Story = {
  render: () => (
    <FormField label="Library path" hint="Provided by the server.">
      {(control) => <output {...control}>/music/library</output>}
    </FormField>
  ),
};
export const LongLabel: Story = {
  render: () => (
    <div className="showcase-narrow">
      <FormField
        label="A long translated description of the collection that wraps over multiple lines"
        hint="Help remains below the control."
      >
        <Textarea rows={3} defaultValue="Mixed Case stays readable." />
      </FormField>
    </div>
  ),
};

export const InlineChoice: Story = {
  render: () => (
    <FormField
      layout="inline"
      label="Keep the queue"
      hint="Playback stays in place."
      error="Choose a setting"
    >
      <Checkbox />
    </FormField>
  ),
};
