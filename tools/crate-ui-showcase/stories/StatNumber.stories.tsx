import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
const meta = {
  id: "components-statnumber",
  title: "Components/Data Display/StatNumber",
  component: StatNumber,
  args: {
    value: "96",
    unit: "kHz",
    label: "Sample rate",
    size: "md",
  },
  argTypes: {
    size: { control: "radio", options: ["sm", "md", "lg", "xl"] },
    labelPosition: { control: "radio", options: ["above", "below"] },
    align: { control: "radio", options: ["start", "center"] },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof StatNumber>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Scale: Story = {
  render: () => (
    <div className="showcase-line">
      {(["sm", "md", "lg", "xl"] as const).map((size) => (
        <StatNumber
          key={size}
          size={size}
          value="128"
          unit="kbps"
          label={size}
        />
      ))}
    </div>
  ),
};
export const MissingAndZero: Story = {
  render: () => (
    <div className="showcase-line">
      <StatNumber value="—" label="Missing data" />
      <StatNumber value="0" label="Known zero" />
    </div>
  ),
};
