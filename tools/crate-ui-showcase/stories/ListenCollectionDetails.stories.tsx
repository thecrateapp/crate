import type { Meta, StoryObj } from "@storybook/react-vite";
import { CollectionDetailsReview } from "../reviews/CollectionDetailsReview";
const meta = {
  id: "listen-collection-details",
  title: "Listen/Collection details and editors",
  component: CollectionDetailsReview,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Actual PlaylistHeroView/CrateHeroFrame/CrateCoverFlowView, CollectionEditorDialog, PlaylistIdentityView, PlaylistTrackSearch/ComposerTrackList, CrateForm/AlbumPickerView, CrateAlbumListView/Item, PlaylistListRowView, CollectionEditorItemRow, CollectionMemberRow/MembersDialog and CollaboratorSearchView. Ordinary/curated/generated playlists and public/owner/collaborator crates reuse these views. Controllers retain authentication, image recovery, search, capabilities, API mutations, confirmation and native submit. Existing real Crate pointer/keyboard drag, rollback and playlist reducers are tested in app consumers; scene callbacks use local fixtures only, including create/edit mode, native DND handles, picker and delete/leave confirmation. 3D coverflow geometry/looping/play eligibility and V2 art sizes are preserved. Full card artwork variants and native/AT/production writes are separate validation.",
      },
    },
  },
} satisfies Meta<typeof CollectionDetailsReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Complete: Story = {};
