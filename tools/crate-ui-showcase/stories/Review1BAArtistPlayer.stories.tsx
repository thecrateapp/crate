import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArtistPlayerReview } from "../reviews/ArtistPlayerReview";
const meta = {
  id: "reviews-1ba-artist-player",
  title: "Reviews/1BA/Artist and player refinements",
  component: ArtistPlayerReview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ArtistPlayerReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Complete: Story = {};
