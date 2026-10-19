import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlaylistArtwork } from "@crate/ui/domain/playlists/PlaylistArtwork";
import {
  CRATE_MARK_URL,
  IMAGE_SAMPLES,
  IMAGE_TRACKS,
  sampleCoverUrl,
} from "../fixtures/image-identity";
const meta = {
  id: "components-playlistartwork",
  title: "Components/Media/PlaylistArtwork",
  component: PlaylistArtwork,
  args: {
    name: "Night tide",
    buildCoverUrl: sampleCoverUrl,
    className: "size-40 rounded-lg",
  },
} satisfies Meta<typeof PlaylistArtwork>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Cover: Story = { args: { coverDataUrl: IMAGE_SAMPLES[0] } };
export const Collages: Story = {
  render: () => (
    <div className="showcase-line">
      {[1, 2, 3, 4].map((count) => (
        <PlaylistArtwork
          key={count}
          name={`${count} covers`}
          tracks={IMAGE_TRACKS.slice(0, count)}
          buildCoverUrl={sampleCoverUrl}
          className="size-28 rounded-lg"
        />
      ))}
    </div>
  ),
};
export const Duplicates: Story = {
  args: { tracks: [IMAGE_TRACKS[0]!, IMAGE_TRACKS[0]!] },
};
export const FailedCover: Story = {
  args: { coverDataUrl: "/1av-failed-playlist.png" },
};
export const AdminFallback: Story = { args: { showFallbackIcon: false } };

export const BrandMark: Story = {
  args: { showCrateMark: true, logoSrc: CRATE_MARK_URL },
};
