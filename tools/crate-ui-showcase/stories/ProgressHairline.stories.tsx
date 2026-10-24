import type { Meta, StoryObj } from "@storybook/react-vite";
import { HairlineProgressStates } from "../fixtures/ProgressUpcomingSamples";
import { HairlineProgressExample } from "../reviews/WebClosureSamples";
const meta = {
  id: "components-progresshairline",
  title: "Components/Feedback/ProgressHairline",
  component: HairlineProgressExample,
  parameters: { layout: "padded" },
} satisfies Meta<typeof HairlineProgressExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Indeterminate: Story = { args: { indeterminate: true } };
export const Complete: Story = { args: { complete: true } };

export const RangeStates: Story = { render: () => <HairlineProgressStates /> };
