import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArtistHeroCompositionExample } from "../reviews/ArtistComponentsReview";
const meta = {
  id: "components-artistheroframe",
  title: "Components/Layout/ArtistHeroFrame",
  component: ArtistHeroCompositionExample,
  parameters: { layout: "padded" },
} satisfies Meta<typeof ArtistHeroCompositionExample>;
export default meta;
export const Base: StoryObj<typeof meta> = {};
export const Mobile: StoryObj<typeof meta> = {
  args: { composition: "mobile" },
};
