import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlaybackButtonExample } from "../reviews/WebClosureSamples";
const meta = {
  id: "components-playbutton",
  title: "Components/Media/PlayButton",
  component: PlaybackButtonExample,
  parameters: { layout: "padded" },
} satisfies Meta<typeof PlaybackButtonExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Loading: Story = { args: { loading: true } };
export const Disabled: Story = { args: { disabled: true } };
