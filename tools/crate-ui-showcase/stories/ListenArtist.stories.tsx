import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArtistPageReview } from "../reviews/ArtistPageReview";
const meta = {
  id: "listen-artist",
  title: "Listen/Artist",
  component: ArtistPageReview,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof ArtistPageReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
