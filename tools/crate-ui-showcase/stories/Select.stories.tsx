import type { Meta, StoryObj } from "@storybook/react-vite";
import { FormField } from "@crate/ui/primitives/FormField";
import { useArgs } from "storybook/preview-api";
import { useState } from "react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@crate/ui/shadcn/select";
const options = [
  "FLAC",
  "ALAC",
  "WAV",
  "AIFF",
  "MP3",
  "AAC",
  "Ogg Vorbis",
  "Opus",
];
const meta = {
  id: "components-select",
  title: "Components/Forms/Select",
  component: Select,
  args: { value: "FLAC", disabled: false },
  render: function Example(args) {
    const [current, updateArgs] = useArgs<typeof args>();
    return (
      <FormField label="Audio format">
        {(control) => (
          <Select
            {...args}
            value={current.value}
            onValueChange={(value) => updateArgs({ value })}
          >
            <SelectTrigger {...control}>
              <SelectValue placeholder="Choose a format" />
            </SelectTrigger>
            <SelectContent>
              {options.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FormField>
    );
  },
} satisfies Meta<typeof Select>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const StableWidth: Story = {
  render: function WidthExample() {
    const [value, setValue] = useState("short");
    return (
      <div className="max-w-sm">
        <FormField label="Stable select">
          {(control) => (
            <Select value={value} onValueChange={setValue}>
              <SelectTrigger {...control}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="short">Name</SelectItem>
                <SelectItem value="long">
                  Recently added to the collection
                </SelectItem>
              </SelectContent>
            </Select>
          )}
        </FormField>
      </div>
    );
  },
};
export const Disabled: Story = { args: { disabled: true } };
export const Placeholder: Story = { args: { value: "" } };
export const UnknownValue: Story = { args: { value: "unknown" } };
export const Invalid: Story = {
  args: { value: "" },
  render: function InvalidExample(args) {
    const [current, updateArgs] = useArgs<typeof args>();
    return (
      <FormField
        label="Audio format"
        required
        error="Choose an available format."
      >
        {(control) => (
          <Select
            {...args}
            value={current.value}
            onValueChange={(value) => updateArgs({ value })}
          >
            <SelectTrigger {...control}>
              <SelectValue placeholder="Choose a format" />
            </SelectTrigger>
            <SelectContent>
              {options.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FormField>
    );
  },
};
export const LongOption: Story = {
  render: () => (
    <div
      className="showcase-narrow h-48 overflow-auto"
      data-scene="scroll-region"
    >
      <div className="pt-32 pb-6">
        <FormField label="Source">
          {(control) => (
            <Select defaultValue="long">
              <SelectTrigger {...control} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="long">
                  An unusually long source name that stays inside the viewport
                </SelectItem>
                <SelectItem value="disabled" disabled>
                  Unavailable source
                </SelectItem>
              </SelectContent>
            </Select>
          )}
        </FormField>
      </div>
    </div>
  ),
};
