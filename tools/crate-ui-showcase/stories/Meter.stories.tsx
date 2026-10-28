import type { Meta, StoryObj } from "@storybook/react-vite";
import { Meter } from "@crate/ui/primitives/Meter";
import { MeterStates } from "../fixtures/ProgressUpcomingSamples";
const meta = {
  id: "components-meter",
  title: "Components/Data Display/Meter",
  component: Meter,
  args: { label: "Tracks", value: 8, max: 10, valueText: "8 / 10" },
} satisfies Meta<typeof Meter>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Storage: Story = {
  args: {
    label: "Storage",
    value: 640,
    max: 1024,
    valueText: "640 MB / 1 GB",
  },
};
export const MissingAndZero: Story = {
  render: () => (
    <div className="grid gap-6">
      <Meter label="Known zero" value={0} max={100} valueText="0 / 100" />
      <Meter label="Unknown" value={null} max={100} valueText="Unknown" />
      <Meter label="No range" value={0} max={0} valueText="0 / 0" />
    </div>
  ),
};

export const NarrowLocalized: Story = {
  render: () => (
    <div className="grid w-full max-w-sm grid-cols-2 gap-6">
      <Meter label="Tracks" value={34} max={50} valueText="34 / 50" />
      <Meter
        label="Biltegiratzea"
        value={640}
        max={1024}
        valueText="640 MB / 1 GB"
      />
    </div>
  ),
};

export const RangeStates: Story = { render: () => <MeterStates /> };
