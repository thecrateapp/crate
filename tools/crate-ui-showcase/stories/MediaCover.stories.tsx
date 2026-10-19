import type { Meta, StoryObj } from "@storybook/react-vite";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { IMAGE_SAMPLES } from "../fixtures/image-identity";
const meta = {
  id: "components-mediacover",
  title: "Components/Media/MediaCover",
  component: MediaCover,
  args: { alt: "Costa Norte", className: "size-32" },
} satisfies Meta<typeof MediaCover>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Image: Story = { args: { src: IMAGE_SAMPLES[0] } };
export const Shapes: Story = {
  render: () => (
    <div className="showcase-line">
      {(["square", "rounded", "circle"] as const).map((shape) => (
        <MediaCover
          key={shape}
          src={IMAGE_SAMPLES[0]}
          alt={shape}
          shape={shape}
          className="size-32"
        />
      ))}
    </div>
  ),
};
export const FailedImage: Story = { args: { src: "/1av-failed-media.png" } };
export const FallbackUrl: Story = {
  args: { src: "/1av-failed-media.png", fallbackUrl: IMAGE_SAMPLES[1] },
};
export const ManagedRenderer: Story = {
  args: {
    src: IMAGE_SAMPLES[0],
    renderImage: ({ src, alt, className, onError }) => (
      <img src={src} alt={alt} className={className} onError={onError} />
    ),
  },
};
