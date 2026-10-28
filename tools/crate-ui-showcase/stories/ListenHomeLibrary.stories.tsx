import type { Meta, StoryObj } from "@storybook/react-vite";
import { HomeLibraryExamples } from "../reviews/HomeLibraryReview";
const meta = {
  id: "listen-home-library",
  title: "Listen/Home and Library",
  component: HomeLibraryExamples,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "HomeGreeting, HeroActions, LibrarySection, LibraryContributionRow, ContributionWithdrawDialog, LibraryBandcampHeader and CrateIndexGrid are actual app-local views. Controllers retain API, authenticated artwork, import/export/withdraw, playback and editor authority. Collection now has six sections; Bandcamp has a single standalone route after the1BD amendment. Current Contributions use an album-style EntityCard grid and their specific contextual actions, documented in Listen/Sharing and imports; this historical first-batch fixture retains its row specimen. existing Artists, Albums and Liked views were reconciled in earlier checkpoints. This first 1BB batch covers list frames/read states. Playlist/Curated/HomePlaylist/HomeSection and Crate details/editors/coverflow/collaborators remain next. ArtistCard context and playlist counts now use MonoLabel, whose uppercase belongs to the component. Names, artist summaries and prose retain their case.",
      },
    },
  },
} satisfies Meta<typeof HomeLibraryExamples>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Lists: Story = {};
