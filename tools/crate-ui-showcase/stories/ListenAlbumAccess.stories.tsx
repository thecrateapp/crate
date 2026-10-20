import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ArtistAlbumScaleExample,
  ArtistBioWidthExample,
} from "../reviews/ArtistPlayerReview";
import {
  AlbumExamples,
  AccessExamples,
  OfflineExamples,
  TrackMetadataExamples,
  ShowGenreExamples,
  ArtistAvatarExamples,
  RowInteractionExamples,
  CollectionNavigationExamples,
} from "../reviews/AlbumAccessReview";
const meta = {
  id: "listen-album-access",
  title: "Listen/Album and access",
  component: AlbumExamples,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "1BA. AlbumHeroFrame/AlbumActionsView, ArtistLibraryFrames, ReleaseCountdown, RemoteImportView, AuthFrame/CredentialsForm/ServerSetupView/AuthCallbackView and OfflineLibraryView are actual app-local views. The approved mockup is the reference; shared forms, headers, states and track visuals own their contracts. Native artwork measurements, auth transport, secure session persistence, API permissions, verified offline asset readiness and player engines remain in Listen controllers. Fixtures neither call the API nor write preferences. Native and live write QA remain separate. The1BD Offline family now covers the complete offline library/management presentation; this earlier specimen also receives canonical per-track quality/duration when its fixture supplies those fields.",
      },
    },
  },
} satisfies Meta<typeof AlbumExamples>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Album: Story = {};
export const Access: Story = { render: () => <AccessExamples /> };
export const Offline: Story = { render: () => <OfflineExamples /> };
export const TrackMetadata: Story = { render: () => <TrackMetadataExamples /> };
export const ShowGenres: Story = { render: () => <ShowGenreExamples /> };
export const ArtistAvatars: Story = { render: () => <ArtistAvatarExamples /> };
export const TrackInteractions: Story = {
  render: () => <RowInteractionExamples />,
};
export const CollectionNavigation: Story = {
  render: () => <CollectionNavigationExamples />,
};
export const ArtistAlbumScale: Story = {
  render: () => <ArtistAlbumScaleExample />,
};
export const ArtistBiography: Story = {
  render: () => <ArtistBioWidthExample />,
};
