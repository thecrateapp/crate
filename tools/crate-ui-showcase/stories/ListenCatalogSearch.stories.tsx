import type { Meta, StoryObj } from "@storybook/react-vite";
import { CatalogSearchReview } from "../reviews/CatalogSearchReview";
const meta = {
  id: "listen-catalog-search",
  title: "Listen/Search/CatalogSearch",
  component: CatalogSearchReview,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Controlled Listen domain search with explicit kinds (track, album, artist, or any subset). CatalogSearch supplies managed CrateImage transport; CatalogSearchView is its exact presentation with injected local artwork in this review. PlaylistTrackSearch and CrateAlbumPicker adopt the same view. Owning controllers retain their existing query/debounce/API and capability rules. Results keep canonical album/artist identity; adding and reopening a playlist retains album artwork. Image targets are48px, artist photos circular. TopBarSearch retains its specialized combobox/recents/keyboard contract; its migration is separate. All fixture actions stay local.",
      },
    },
  },
} satisfies Meta<typeof CatalogSearchReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const AllKinds: Story = {};
export const TracksOnly: Story = { args: { initialKinds: ["track"] } };
export const AlbumsOnly: Story = { args: { initialKinds: ["album"] } };
export const ArtistsOnly: Story = { args: { initialKinds: ["artist"] } };
export const TracksAndAlbums: Story = {
  args: { initialKinds: ["track", "album"] },
};
