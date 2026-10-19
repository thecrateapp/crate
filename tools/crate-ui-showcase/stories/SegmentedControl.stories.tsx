import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
function Example() {
  const [value, setValue] = useState("all");
  return (
    <SegmentedControl
      as="radio"
      label="Scope"
      value={value}
      onValueChange={setValue}
      items={[
        { value: "all", label: "Entire library" },
        { value: "local", label: "Local only" },
        { value: "blocked", label: "Unavailable", disabled: true },
      ]}
    />
  );
}
const meta = {
  id: "components-segmentedcontrol",
  title: "Components/Forms/SegmentedControl",
  component: Example,
} satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Keyboard: Story = {};
