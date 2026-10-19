import { ModalExample } from "../reviews/LayersReview";
import { TooltipProvider } from "@crate/ui/shadcn/tooltip";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { AppModal } from "@crate/ui/primitives/AppModal";
import { ArtistBioWidthExample } from "../reviews/ArtistPlayerReview";
const meta = {
  id: "components-appmodal",
  title: "Components/Overlays/AppModal",
  component: AppModal,
  args: {
    open: false,
    onClose: () => {},
    title: "Playlist settings",
    description: "Choose how this playlist is shared.",
    children: <p>Playlist content</p>,
  },
} satisfies Meta<typeof AppModal>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {
  render: () => (
    <TooltipProvider>
      <ModalExample />
    </TooltipProvider>
  ),
};
export const FullWidthBiography: Story = {
  render: () => <ArtistBioWidthExample />,
};
