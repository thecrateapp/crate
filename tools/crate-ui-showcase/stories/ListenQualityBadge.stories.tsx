import type { Meta, StoryObj } from "@storybook/react-vite";
import { QualityBadge } from "../../../app/listen/src/components/player/bar/QualityBadge";
import { getQualityBadge } from "../../../app/listen/src/components/player/bar/player-bar-utils";
const meta = {
  id: "listen-quality-badge",
  title: "Listen/QualityBadge",
  component: QualityBadge,
  tags: ["autodocs"],
  args: {
    badge: getQualityBadge({
      format: "flac",
      bitDepth: 16,
      sampleRate: 44100,
    })!,
  },
  parameters: {
    docs: {
      description: {
        component:
          "One actual Listen component for album heroes, every TrackRow and the player. Solar soundwave glyph; cyan lossless/high, amber hi-res, neutral standard/low. Built on the unchanged 24px InfoBadge recipe. Individual source depth/rate/bitrate are optional; no album-quality inference or per-row detail requests. Streaming delivery remains distinct from source through origin. The adapter remains app-local because Admin does not consume this quality contract.",
      },
    },
  },
} satisfies Meta<typeof QualityBadge>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Lossless: Story = {};
export const HiRes: Story = {
  args: {
    badge: getQualityBadge({
      format: "flac",
      bitDepth: 24,
      sampleRate: 176400,
    })!,
  },
};
export const FormatOnly: Story = {
  args: { badge: getQualityBadge({ format: "flac" })! },
};
export const High: Story = {
  args: { badge: getQualityBadge({ format: "aac", bitrate: 320 })! },
};
export const Standard: Story = {
  args: { badge: getQualityBadge({ format: "mp3", bitrate: 192 })! },
};
export const Low: Story = {
  args: { badge: getQualityBadge({ format: "mp3", bitrate: 96 })! },
};
export const Streaming: Story = {
  args: {
    origin: "stream",
    badge: getQualityBadge({ format: "aac", bitrate: 256 })!,
  },
};
