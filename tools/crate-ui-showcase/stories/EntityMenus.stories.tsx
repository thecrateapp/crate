import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  EntityMenuExample,
  TouchSheetExample,
} from "../reviews/WebClosureSamples";
const meta = {
  id: "components-entitymenus",
  title: "Components/Actions/Entity menus",
  component: EntityMenuExample,
  parameters: { layout: "padded" },
} satisfies Meta<typeof EntityMenuExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const LongLabels: Story = { args: { longLabel: true } };
export const Disabled: Story = { args: { disabled: true } };
export const TouchSheet: Story = { render: () => <TouchSheetExample /> };
