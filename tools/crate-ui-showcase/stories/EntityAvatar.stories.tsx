import type { Meta, StoryObj } from "@storybook/react-vite";
import { EntityAvatar } from "@crate/ui/domain/entity/EntityAvatar";
import { IMAGE_SAMPLES } from "../fixtures/image-identity";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
const meta = {
  id: "components-entityavatar",
  title: "Components/Data Display/EntityAvatar",
  component: EntityAvatar,
  args: { name: "Nina Simone", size: "lg" },
} satisfies Meta<typeof EntityAvatar>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const AccentRing: Story = {
  args: { ring: "accent", src: IMAGE_SAMPLES[0] },
};
export const SubtleRing: Story = { args: { ring: "subtle" } };
export const Status: Story = {
  args: { badge: <StatusDot tone="on" />, badgeLabel: "Listening now" },
};
export const Rounded: Story = { args: { shape: "rounded", size: "xl" } };
