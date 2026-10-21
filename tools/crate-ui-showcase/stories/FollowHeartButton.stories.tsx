import type { Meta, StoryObj } from "@storybook/react-vite";
import { FollowExample } from "../reviews/WebClosureSamples";
const meta = {
  id: "components-followheartbutton",
  title: "Components/Actions/FollowHeartButton",
  component: FollowExample,
  parameters: { layout: "padded" },
} satisfies Meta<typeof FollowExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Loading: Story = { args: { loading: true } };
export const Disabled: Story = { args: { disabled: true } };
