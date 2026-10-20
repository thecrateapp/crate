import type { Meta, StoryObj } from "@storybook/react-vite";
import { SharingImportsReview } from "../reviews/SharingImportsReview";
const meta = {
  id: "listen-sharing-imports",
  title: "Listen/Sharing and imports",
  component: SharingImportsReview,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Actual Listen-local ShareSheetView, Bandcamp page/item/actions, UploadView, RemoteImportView and LibraryContributionCard grid/confirmation. Contributions use actual EntityCard in the default MediaGrid, matching Albums, with source metadata below identity and Export/Remove contribution in their contextual menu. Source captions use actual uppercase MonoLabel without a chip: Upload in the subtle tone with a12px Solar upload icon, Bandcamp in accent with its12px brand mark. Icons are decorative; source names remain readable. The adapter reuses canonical album artwork, playback and save helpers. Available contributions open their album and expose the same lazy AlbumCardMenu as Albums; missing local albums offer no broken navigation or playback. Fixtures use the actual card view, pure contribution action builder and shared menus with local callbacks. Upload receipts/toasts and removal messages use friendly localized copy without internal task IDs; the receipt retains file counts and removal identifies the album while work continues in the background. Bandcamp has one canonical /bandcamp page, outside Collection; old collection destinations redirect and the existing Settings link points there. Shared AppModal, EntityCard, EntityRow, MediaCover, PageHeader/SectionHeader, StatNumber, MonoLabel, FormField/Input and ProgressHairline own their roles. Production adapters retain native/clipboard/canvas sharing, authenticated artwork, import permissions, SSE/idempotency, upload/chunk protocol, and export/withdraw authority. Bandcamp tiles reuse the actual album EntityCard: menu over the upper-left of the cover, canonical artwork inset, title and artist across the available width, with Import/Open in the contextual menu. Bandcamp owned rows retain56px artwork and direct actions. Four varied titles/artists exercise actual grid density in the fixtures; menus use the real pure Bandcamp action builder with local callbacks. Failed Bandcamp reads offer retry instead of fake zero totals; unknown progress stays indeterminate. Upload preserves a real centered file drop target with the decorative CrateLogo and canonical picker Button; the hidden native Input remains the file-picker transport. Drops stage files until explicit import; text/empty drops preserve the selection and busy uploads reject replacements. Fixtures use local callbacks and manually selected progress snapshots; the busy share fixture resolves locally after2.5seconds. No network/share/clipboard/storage mutation. Names retain case; technical captions uppercase. The approved mockup and later amendments remain the reference. Offline complete and1BEremain later cuts.",
      },
    },
  },
} satisfies Meta<typeof SharingImportsReview>;
export default meta;
export const Sharing: StoryObj<typeof meta> = {};
export const Bandcamp: StoryObj<typeof meta> = {
  args: { initialTab: "bandcamp" },
};
export const Upload: StoryObj<typeof meta> = { args: { initialTab: "upload" } };
export const RemoteImport: StoryObj<typeof meta> = {
  args: { initialTab: "remote" },
};
export const Contributions: StoryObj<typeof meta> = {
  args: { initialTab: "contributions" },
};
