import type { Meta, StoryObj } from "@storybook/react-vite";
import { ConfirmationExample } from "../reviews/WebClosureSamples";
const meta = {
  id: "components-confirmdialog",
  title: "Components/Overlays/ConfirmDialog",
  component: ConfirmationExample,
  parameters: { layout: "padded" },
} satisfies Meta<typeof ConfirmationExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Typed: Story = { args: { typed: true } };
export const Failure: Story = { args: { fail: true } };
