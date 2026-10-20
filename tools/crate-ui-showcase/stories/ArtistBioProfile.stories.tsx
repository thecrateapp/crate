import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArtistBioExample } from "../reviews/ArtistComponentsReview";
const meta = {
  id: "components-artistbioprofile",
  title: "Components/Data Display/ArtistBioProfile",
  component: ArtistBioExample,
  parameters: { layout: "padded" },
} satisfies Meta<typeof ArtistBioExample>;
export default meta;
export const Base: StoryObj<typeof meta> = {};
export const Sparse: StoryObj<typeof meta> = { args: { sparse: true } };
