import type { Meta, StoryObj } from "@storybook/react-vite";
import { Avatar } from "@crate/ui/primitives/Avatar";
import { IMAGE_SAMPLES } from "../fixtures/image-identity";
const meta = {
  id: "components-avatar",
  title: "Components/Data Display/Avatar",
  component: Avatar,
  args: { name: "Ada Lovelace" },
} satisfies Meta<typeof Avatar>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Sizes: Story = {
  render: () => (
    <div className="showcase-line">
      {(["xs", "sm", "md", "lg", "xl"] as const).map((size) => (
        <Avatar key={size} name={size} size={size} />
      ))}
    </div>
  ),
};
export const Image: Story = { args: { src: IMAGE_SAMPLES[0], size: "xl" } };
export const FailedImage: Story = { args: { src: "/1av-failed-avatar.png" } };
export const Decorative: Story = { args: { alt: "" } };
export const Rounded: Story = { args: { shape: "rounded", size: "lg" } };
