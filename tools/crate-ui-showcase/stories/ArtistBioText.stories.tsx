import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArtistBioTextExample } from "../reviews/ArtistComponentsReview";
const meta = {
  id: "components-artistbiotext",
  title: "Components/Data Display/ArtistBioText",
  component: ArtistBioTextExample,
  parameters: { layout: "padded" },
} satisfies Meta<typeof ArtistBioTextExample>;
export default meta;
export const Base: StoryObj<typeof meta> = {};
