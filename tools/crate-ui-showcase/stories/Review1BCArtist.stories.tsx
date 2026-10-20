import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArtistPageReview } from "../reviews/ArtistPageReview";
const meta = {
  id: "reviews-1bc-artist",
  title: "Reviews/1BC/Artist",
  component: ArtistPageReview,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof ArtistPageReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
