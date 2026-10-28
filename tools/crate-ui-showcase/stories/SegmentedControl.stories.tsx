import type { Meta, StoryObj } from "@storybook/react-vite";
import { useArgs } from "storybook/preview-api";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
const items = [
  { value: "all", label: "Entire library", controls: "panel-all" },
  { value: "local", label: "Local only", controls: "panel-local" },
  { value: "blocked", label: "Unavailable", disabled: true },
];
const meta = {
  id: "components-segmentedcontrol",
  title: "Components/Forms/SegmentedControl",
  component: SegmentedControl,
  args: {
    onValueChange: () => {},
    items,
    value: "all",
    as: "radio",
    label: "Scope",
    variant: "solid",
    size: "md",
    fullWidth: false,
  },
  argTypes: {
    as: { control: "radio", options: ["radio", "tabs"] },
    variant: { control: "radio", options: ["solid", "tonal"] },
    size: { control: "radio", options: ["sm", "md"] },
    className: { table: { disable: true } },
    itemClassName: { table: { disable: true } },
  },
  render: function Example(args) {
    const [current, updateArgs] = useArgs<typeof args>();
    return (
      <div className="showcase-stack">
        <SegmentedControl
          {...args}
          value={current.value}
          onValueChange={(value) => updateArgs({ value })}
        />
        {args.as === "tabs" && (
          <>
            <div
              role="tabpanel"
              id="panel-all"
              aria-label="Entire library"
              hidden={current.value !== "all"}
            >
              All library items
            </div>
            <div
              role="tabpanel"
              id="panel-local"
              aria-label="Local only"
              hidden={current.value !== "local"}
            >
              Local library items
            </div>
          </>
        )}
      </div>
    );
  },
} satisfies Meta<typeof SegmentedControl>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Keyboard: Story = {};
export const Tabs: Story = { args: { as: "tabs" } };
export const Tonal: Story = { args: { variant: "tonal" } };
export const FullWidth: Story = { args: { fullWidth: true } };
