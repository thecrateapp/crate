import type { Meta, StoryObj } from "@storybook/react-vite";
import { ExploreBrowseReview } from "../reviews/ExploreBrowseReview";
const meta = {
  id: "listen-explore-browse",
  title: "Listen/Explore and browse",
  component: ExploreBrowseReview,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Actual Listen-local ExploreFeatureCard, ExploreDecades, ExploreMoodChoices, GenreTileView, GenreHeroView, BrowseReadState and BrowseDetailFrame. Canonical solid Card chrome, MonoLabel context and FilterChip navigation. Genre tile menu/managed artwork, card grids and playback remain in existing controllers. Browse selection preserves unrelated URL state. This first 1BC batch covers Explore/genre/decade/category; Artist, upcoming events, Radio and Paths follow separately. Local fixture callbacks never call the API, audio or persisted preferences.",
      },
    },
  },
} satisfies Meta<typeof ExploreBrowseReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Complete: Story = {};
