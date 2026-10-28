import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArtistPageReview } from "../reviews/ArtistPageReview";
const meta = {
  id: "listen-artist",
  title: "Listen/Artist",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Actual artist views. The biography Show more action uses the shared accent MonoLabel and glowing dot, aligned with the preceding biography text. Its native callback still opens the existing full-width biography modal.",
      },
    },
  },
  component: ArtistPageReview,
  tags: ["autodocs"],
} satisfies Meta<typeof ArtistPageReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
